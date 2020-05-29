---
title: Prometheus TSDB internals
date: 2020-05-24 20:15:00 +0800
categories: prometheus
---

Prometheus has local and remote storage. At the beginning, it creates a local
storage, a remote storage, and a fanout storage. A fanout storage is like a
wrapper storage that wraps a primary storage and multiple secondary storages,
which proxies reads and writes through to the underlying.

Internally, Prometheus uses a type of struct called `Head` to maintain a series
of data, and to persist the in-memory data to the disk.

When opening a local db by `tsdb.Open()`, it loads data from the write ahead log
and prepares the head for writes. It then starts a goroutine to compact two-hour
blocks per minute (with exponential backoff on error).

## Memory series

In Prometheus, a series is a struct of type `memSeries`, which contains an ID
(also called `ref`), a label set, and other fields.

A series holds a slice of memory chunks that each of them is of type `memChunk`,
which is used to store timestamp and value pairs (samples). Samples are appended
(encoded) into a memory chunk. When some condition matches, a chunk is marked as
complete (it will be compacted) and a new chunk is created (analogous to `cut`).
The `headChunk` field always points to the current chunk to append.

{% highlight golang linenos start_line=1704 name=tsdb/head.go %}
type memSeries struct {
	sync.RWMutex

	ref          uint64
	lset         labels.Labels
	chunks       []*memChunk
	headChunk    *memChunk
	chunkRange   int64
	firstChunkID int

	nextAt        int64 // Timestamp at which to cut the next chunk.
	sampleBuf     [4]sample
	pendingCommit bool // Whether there are samples waiting to be committed to this series.

	app chunkenc.Appender // Current appender for the chunk.

	txs *txRing
}
{% endhighlight %}

What's the condition that a new chuck should be created? `nextAt` is a field
that indicates that. If the sample's timestamp is greater than or equal to
`nextAt`, a new chunk should be created. `nextAt` is initialized by `chunkRange`
field (by default it's 2 hours), but is changed by its increasing velocity when
it's 25% full of 120 samples. The number 120 is based on Gorilla white papers,
which offers near-optimal compression ratio.

**Tip:** For more information about Gorilla white papers, please visit
[here](https://www.vldb.org/pvldb/vol8/p1816-teller.pdf).
{: .notice--info}

Internally, `memChunk` is a wrapper around `chunkenc.XORChunk`.
`chunkenc.XORChunk` and its appender implements Gorilla. Each `XORChunk` has a
bits stream, samples are encoded and compressed into that
stream. When compacting the chunk, it checks if the remainder capacity of the
bits stream is over a threshold (32). If so, it will decrease the capacity by
copying it to a new slice of bytes.

## Head

Head handles reads and writes of time series data within a time window. It holds
a `lastSeriesID` filed of type `uint64`, which starts at 1 for the first series
and increases by 1 every time.

### Stripe series

Head holds a `series` field which is of type `stripeSeries`. When creating a
`stripeSeries`, the size by default is 2^14.

The `stripeSeries` is like a list of buckets. Each bucket has a
`map[uint64]*memSeries`, `seriesHashmap` and a `stripeLock`.
`map[uint64]*memSeries` is a map of series ID and series value.  `seriesHashmap`
is a map of *hash value of series label set* and *a slice of `*memSeries`*. Why
this? Because the hash value of series label set may not be unique, so it needs
to use a slice to store series values.

So by using such a struct, it not only can quickly find a series by its ID, but
also by a label set. Given an ID, it finds the bucket by `id & size - 1`. Given
a label set hash, it finds the bucket by `hash & size - 1`.

{% highlight golang linenos start_line=1567 name=tsdb/head.go %}
type stripeSeries struct {
	size   int
	series []map[uint64]*memSeries
	hashes []seriesHashmap
	locks  []stripeLock
}
{% endhighlight %}

### Head appender

In every scrape, `Head` returns a new `headAppender` which the scraper uses to
add samples.

For adding, it has two methods: `Add` and `AddFast`. `Add` first checks if the
series identified by the passed label set already exists in `stripeSeries`. If
not, it creates one, adds it to `stripeSeries` and `postings`. For each label,
it collects possible values for the label name into `values`, and adds its name
and value as keys of a `symbols` map. Note that `stripeSeries`, `postings`,
`values` and `symbols` are all fields of the head. Finally, it adds the created
series to `series` field of `headAppender` (used when writing WAL) and calls
`AddFast` to do remainder work.

As it name suggests, `AddFast` runs faster because it doesn't need to create a
series. It should only be called when a series has already been created in the
head. It finds the created series by ID from the head, and then adds the sample
and series to `samples` slice and `sampleSeries` slice respectively (the two
slices are one-to-one).

{% highlight golang linenos start_line=936 name=tsdb/head.go %}
type headAppender struct {
	head         *Head
	minValidTime int64 // No samples below this timestamp are allowed.
	mint, maxt   int64

	series       []record.RefSeries
	samples      []record.RefSample
	sampleSeries []*memSeries

	appendID, cleanupAppendIDsBelow uint64
}
{% endhighlight %}

When all samples for a scrape are added in `headAppender`, the scraper calls
`headAppender.Commit()` to complete. It checks if there are newly created series
(`series` is not empty), if so, it writes them to ahead log. Then it checks if
`samples` is empty, if not, it writes them to ahead log. Finally, it iterates
`samples`, add appends each sample to its series. It's at this time that all
samples for a scrape are truly added to series.

## Compact

The compactor first checks whether the head is compactable. If yes, it compacts
head. Finally, it compacts blocks. When the head time range is 1.5 times the
chunk range, the head will be compacted.

### Compact head

For this operation, it mainly calls `Compactor.Write`. It allocates a new
`ULID`, and initializes a `BlockMeta` with min/max time range and compaction
information. It then creates a new temporary directory with `<ULID>.tmp` as
name. It populates a block, and writes `BlockMeta` to a `meta.json` file in the
block root directory. After that, it creates an empty tombstones file by passing
in an empty in-memory tombstone reader. Finally, it replaces the temporary
directory name with `ULID`.

The relevant code location is shown in below snippet.

{% highlight golang linenos start_line=526 name=tsdb/compact.go %}
func (c *LeveledCompactor) write(dest string, meta *BlockMeta, blocks ...BlockReader) (err error) {
...
{% endhighlight %}

Compact data if possible. After successful compaction blocks are reloaded
which will also trigger blocks to be deleted that fall out of the retention
window.
If no blocks are compacted, the retention window state doesn't change. Thus,
this is sufficient to reliably delete old data.
Old blocks are only deleted on reload based on the new block's parent information.
See DB.reload documentation for further information.

## Postings

`Postings` is a struct that stores a map of *label name* and *a map of label
value and series id pair* pair. That's to say, the key of the top level map is
the label name from a set of labels, with its value being a map. Furthermore,
The key of the second level map is the label value from a set of labels, with
its value being a slice of the series ids. So we can quickly get all series ids
by a label.

It also provides an empty label which is called `allPostingsKey`. When adding a
new series id for a set of labels, the series id is also added for that empty
label. So we can quickly get all series ids in one `Postings`.

{% highlight golang linenos start_line=38 name=tsdb/index/postings.go %}
type MemPostings struct {
	mtx     sync.RWMutex
	m       map[string]map[string][]uint64
	ordered bool
}
{% endhighlight %}

## On-disk layout

The directory structure of a Prometheus server's data directory looks something like this:

```
./data
├ 01BKGV7JBM69T2G1BGBGM6KB12
│   └ meta.json
├ 01BKGTZQ1SYQJTR4PB43C8PD98
│   ├ chunks
│   │   └ 000001
│   ├ tombstones
│   ├ index
│   └ meta.json
├ 01BKGTZQ1HHWHV8FBJXW1Y3W0K
│   └ meta.json
├ 01BKGV7JC0RY8A6MACW02A2PJD
│   ├ chunks
│   │   └ 000001
│   ├ tombstones
│   ├ index
│   └ meta.json
└ wal
    ├ 00000002
    └ checkpoint.000001
```

### Chunks

Each chunks file is composed of the following:

1. **A header section** which contains a magic number, a format version, and
   some padding bytes.
1. **Multiple chunk sections** that each of them contains a chunk of encoded
   timestamp/value pairs.

Chunks are segmented into segment files when its file size is over 512MiB.  A
chunk in a file can be referenced from the index file by uint64. The lower 4
bytes of the reference value is the chunk's offset in the file, and the higher 4
bytes are the segment sequence number.

**Tip:** For more information about the chunks file format, please visit
[here](https://github.com/prometheus/prometheus/blob/v2.18.1/tsdb/docs/format/chunks.md).
{: .notice--info}

### Index

The index file format is composed of following sections:

1. **A header section** which contains a magic number and format version.
1. **A symbol table section** which holds a sorted list of deduplicated strings to reduce
   the total index size, and are referenced by subsequent sections.
1. **A series section** which contains a sequence of series. Each of them
   contains its label set and chunks. The chunk contains time range information
   and chunk file's offset from which the chunk data begins.
1. **Multiple label index sections** which are no longer used.
1. **Multiple postings sections** that each of them contains a list of series
   which are associated with a given label name and value.
1. **A label index table section** which is no longer used.
1. **A postings table section** which contains a sequence of postings offset
   entries. Each entry contains a label pair and an offset of the index file
   from which the postings (that contains a sequence of series) begins.
1. **A TOC (table of contents) section** that contains the offsets to the
   beginning of the above sections.

**Tip:** For more information about the index file format, please visit
[here](https://github.com/prometheus/prometheus/blob/v2.18.1/tsdb/docs/format/index.md).
{: .notice--info}

### Tombstones

The tombstones file is composed of the following:

1. **A header section** which contains a magic number and format version.
1. **A tombstones section** that contains a sequence of tombstone. Each
   tombstone contains a ref and a time range.

**Tip:** For more information about the tombstones file format, please visit
[here](https://github.com/prometheus/prometheus/blob/v2.18.1/tsdb/docs/format/tombstones.md).
{: .notice--info}
