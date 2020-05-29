---
title: Prometheus scrape internals
date: 2020-05-24 16:17:00 +0800
categories: prometheus
---

Scrape is an action that Prometheus server fetches metrics data from a list of
configured targets. The targets are also called exporters.

## Scrape discovery manager

The scrape discovery manager is actually the service discovery manager. Here,
finding the scrape targets is the same meaning as discovering services.

At the beginning, the discovery manager starts a goroutine called `sender` which
is responsible for sending all groups of targets to an exported channel, where the
clients are waiting to receive. The sender repeatedly waits on a `triggerSend`
channel, if a signal is received, it then signals the clients.

After loading configuration, `discovery.Manager.ApplyConfig` will be called. It
iterates over a map with job name and `ServiceDiscoveryConfig` pair
(Interestingly, `StaticConfigs` is also a field of `ServiceDiscoveryConfig`
struct), register each `SDConfig` (except `StaticConfigs`) as a provider, and each
provider owns a field that implements `Discoverer` interface. For
`StaticConfigs`, it creates a `StaticProvider`, and make it act as a
`Discoverer` by returning groups of targets directly.

`Discoverer` interface provides information about target groups. It maintains a set
of sources from which `TargetGroups` can originate. Whenever a discovery provider
detects a potential change, it sends the `TargetGroup` through its channel.

{% highlight golang name=discovery/manager.go %}
type Discoverer interface {
	Run(ctx context.Context, up chan<- []*targetgroup.Group)
}
{% endhighlight %}

The discovery manager then starts each of providers. It starts a goroutine to
run `Discoverer`, and another goroutine to update groups of targets and trigger
`sender` to send all groups of targets.

## Scrape manager

At first, the scrape manager starts a goroutine to repeatedly wait to receive
from an internal `triggerReload` channel in order to reload. It then repeatedly
waits to receive from a target sets channel to which [scrape discovery
manager](#scrape-discovery-manager) sends. When target sets are updated, the
scrape manager will send a signal to `triggerReload` channel to do reloading
stuff.

On reloading, it iterates over the target sets to check if a `scrapePoll` with
the set name as key exists. If it doesn't exist, it creates one. It then starts
a goroutine to execute `scrapePoll.Sync()` to scrape groups of targets. For each
target, it creates a scrape loop, starts a goroutine to execute scrape loop's
`run` method, which will repeatedly scrape that target, parse scrape response,
and append samples to the head.

### Scrape a target

Package `scrape` provides a `targetScraper` struct which implements scraper
interface for a target. When scraping, it checks if an http request has been
created, if created, reuses it, otherwise creates a new one. It then sends the
request to the http client to execute.

{% highlight golang linenos start_line=521 name=scrape/scrape.go %}
type targetScraper struct {
	*Target

	client  *http.Client
	req     *http.Request
	timeout time.Duration

	gzipr *gzip.Reader
	buf   *bufio.Reader
}
{% endhighlight %}

### Parse scrape response

During a scrape, a scrape target is expected to export a list of data items that
conforms to some format. Each data item begins with a `HELP` line, followed by a
`TYPE` line and a `UNIT` line, and ends with one or more metric lines
(`samples`). Each metric line is called a `sample`. A `sample` is composed of a
`series`, a metric value and an optional timestamp. A `series` is composed of
the metric name and optional labels.

```
# HELP <metric_name> <description>
# TYPE <metric_name> <metric_type>
# UNIT <metric_name> <metric_unit>
<metric_name>{<labels>} <metric_value> [timestamp]
<metric_name>{<labels>} <metric_value> [timestamp]
...
```

For example, below is the partial of an http response from node exporter.

{% highlight conf %}
# HELP node_cpu_seconds_total Seconds the cpus spent in each mode.
# TYPE node_cpu_seconds_total counter
node_cpu_seconds_total{cpu="0",mode="system"} 450.51
node_cpu_seconds_total{cpu="0",mode="user"} 1426.44
node_cpu_seconds_total{cpu="1",mode="system"} 416.5
node_cpu_seconds_total{cpu="1",mode="user"} 1456.85
# HELP node_memory_Active_bytes Memory information field Active_bytes.
# TYPE node_memory_Active_bytes gauge
node_memory_Active_bytes 5.068701696e+09
{% endhighlight %}

### Append samples to the head

When the scrape manager is created, it's initialized with a fanout storage. So
when appending samples, it actually uses the `storage.Appender` provided by the
fanout storage. Let's ignore remote storage for now, only consider local
storage. The local storage `DB` uses `headAppender` as the implementation, so
samples are finally appended through `headAppender`.

{% highlight golang linenos start_line=683 name=tsdb/db.go %}
func (db *DB) Appender() storage.Appender {
	return dbAppender{db: db, Appender: db.head.Appender()}
}

type dbAppender struct {
	storage.Appender
	db *DB
}
{% endhighlight %}

When all samples from a scrape are added, it calls `Commit`. When committing, it
firstly writes ahead log, then it iterates over samples, and appends each sample
to the corresponding memory series. If some error happens, it will call `Rollback`.
