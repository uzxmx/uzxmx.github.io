---
title: Redis RDB internals
date: 2020-06-13 10:11:00 +0800
categories: redis
toc: false
---

This post aims to covering how Redis dumps in-memory data into a disk file.  The
version of Redis used is 6.0.5.

First, let's look at how Redis prepares for the dump. In `main` function, Redis
initializes a global `redisServer` structure, registering a timer callback
`serverCron` (should be scheduled per millisecond) in `aeEventLoop`(which is a
member of `redisServer`). At the end, it starts an infinity loop to wait for
some event to happen and execute.

```
-> main // src/server.c:4967L
   -> ...
   -> initServer // :5126L
      -> ...
      -> aeCreateTimeEvent(server.el, 1, serverCron, NULL, NULL) // :2877L
      -> ...
  -> ...
  -> aeMain(server.el) // :5173L
```

**Tip:** There are several `ae.c` and `ae_*.c` files in `src` directory, which are
used to abstract out the event-driven API for different systems. The name `ae`
may stand for `asynchronous event` or `another event`, or just `an event`
mechanism.
{: .notice--info}

Let's now look at how `aeMain` works. As we mentioned above, it repeatedly calls
`aeProcessEvents` to process events.

{% highlight c linenos start_line=536 name=src/ae.c %}
void aeMain(aeEventLoop *eventLoop) {
    eventLoop->stop = 0;
    while (!eventLoop->stop) {
        aeProcessEvents(eventLoop, AE_ALL_EVENTS|
                                   AE_CALL_BEFORE_SLEEP|
                                   AE_CALL_AFTER_SLEEP);
    }
}
{% endhighlight %}

In `aeProcessEvents` function, it calculates the shortest time to wait before a
timer event happens. It then waits for events on created file descriptors, with
or without time out. Finally it calls `processTimeEvents` to check which timer
callbacks should be called.

{% highlight c linenos start_line=386 name=src/ae.c %}
int aeProcessEvents(aeEventLoop *eventLoop, int flags)
{
    ...
    if (eventLoop->maxfd != -1 ||
        ((flags & AE_TIME_EVENTS) && !(flags & AE_DONT_WAIT))) {
        ...

        if (flags & AE_TIME_EVENTS && !(flags & AE_DONT_WAIT))
            shortest = aeSearchNearestTimer(eventLoop);
        if (shortest) {
            long now_sec, now_ms;

            aeGetTime(&now_sec, &now_ms);
            tvp = &tv;

            /* How many milliseconds we need to wait for the next
             * time event to fire? */
            long long ms =
                (shortest->when_sec - now_sec)*1000 +
                shortest->when_ms - now_ms;

            if (ms > 0) {
                tvp->tv_sec = ms/1000;
                tvp->tv_usec = (ms % 1000)*1000;
            } else {
                tvp->tv_sec = 0;
                tvp->tv_usec = 0;
            }
        } else {
          ...
        }
        ...
    }
    /* Check time events */
    if (flags & AE_TIME_EVENTS)
        processed += processTimeEvents(eventLoop);

    return processed; /* return the number of processed file/time events */
}
{% endhighlight %}

In `processTimeEvents` function, it calls `te->timeProc` which is a function
pointer registered before (in above situation, it's `serverCron`).

{% highlight c linenos start_line=288 name=src/ae.c %}
static int processTimeEvents(aeEventLoop *eventLoop) {
    ...
    te = eventLoop->timeEventHead;
    maxId = eventLoop->timeEventNextId-1;
    while(te) {
        ...
        aeGetTime(&now_sec, &now_ms);
        if (now_sec > te->when_sec ||
            (now_sec == te->when_sec && now_ms >= te->when_ms))
        {
            int retval;

            id = te->id;
            te->refcount++;
            retval = te->timeProc(eventLoop, id, te->clientData);
            te->refcount--;
            processed++;
            if (retval != AE_NOMORE) {
                aeAddMillisecondsToNow(retval,&te->when_sec,&te->when_ms);
            } else {
                te->id = AE_DELETED_EVENT_ID;
            }
        }
        te = te->next;
    }
    return processed;
}
{% endhighlight %}

We now come to `serverCron`. `serverCron` is a versatile function that is used
to do a number of things that need to be done asynchronously, including:

* Remove expired keys
* Dump in-memory data into a disk file
* Replication reconnection
* ...

In this post, we only focus on data dump. In `redis.conf`, we can use `save`
directive multiple times to specify when to save the db on disk. For example:

```
save 900 1
save 300 10
save 60 10000
```

In the above example, saveing on disk will happen either:

* After 900 seconds (15 min) if at least 1 key changed
* After 300 seconds (5 min) if at least 10 keys changed
* After 60 seconds if at least 10000 keys changed

On server initialization, the `save` directives are parsed into a list of
`saveparam` stored in the global `redisServer` structure. So here in
`serverCron` function, it iterates over the `saveparams` list to check if it
needs to call `rdbSaveBackground`.

{% highlight c linenos start_line=1845 name=src/server.c %}
int serverCron(struct aeEventLoop *eventLoop, long long id, void *clientData) {
    ...

        /* If there is not a background saving/rewrite in progress check if
         * we have to save/rewrite now. */
        for (j = 0; j < server.saveparamslen; j++) {
            struct saveparam *sp = server.saveparams+j;

            /* Save if we reached the given amount of changes,
             * the given amount of seconds, and if the latest bgsave was
             * successful or if, in case of an error, at least
             * CONFIG_BGSAVE_RETRY_DELAY seconds already elapsed. */
            if (server.dirty >= sp->changes &&
                server.unixtime-server.lastsave > sp->seconds &&
                (server.unixtime-server.lastbgsave_try >
                 CONFIG_BGSAVE_RETRY_DELAY ||
                 server.lastbgsave_status == C_OK))
            {
                serverLog(LL_NOTICE,"%d changes in %d seconds. Saving...",
                    sp->changes, (int)sp->seconds);
                rdbSaveInfo rsi, *rsiptr;
                rsiptr = rdbPopulateSaveInfo(&rsi);
                rdbSaveBackground(server.rdb_filename,rsiptr);
                break;
            }
        }

  ...
}
{% endhighlight %}

In `rdbSaveBackground` function, it calls `redisFork` to create a child process,
and the child will do the real saving job. You may worry that because a new
process is created, the totally used memory will become 2x. Don't worry, because
of COW (copy-on-write), unless writing to memory operation happens, the memory
won't become 2x.

{% highlight c linenos start_line=1340 name=src/rdb.c %}
int rdbSaveBackground(char *filename, rdbSaveInfo *rsi) {
    ...

    if ((childpid = redisFork()) == 0) {
        int retval;

        /* Child */
        redisSetProcTitle("redis-rdb-bgsave");
        redisSetCpuAffinity(server.bgsave_cpulist);
        retval = rdbSave(filename,rsi);
        if (retval == C_OK) {
            sendChildCOWInfo(CHILD_INFO_TYPE_RDB, "RDB");
        }
        exitFromChild((retval == C_OK) ? 0 : 1);
    } else {
        ...
    }
    return C_OK; /* unreached */
}
{% endhighlight %}

So let's look at the function `rdbSave` which dose the real data dump.

In `rdbSave`, it first creates a temporary file, and then writes header information in the
file, iterates over each database and writes database information and key-value
pairs into the file, finally appends `EOF` marker and an 8-bytes checksum. At
the end, it closes the temporary file, and renames it to the final filename.

```
-> rdbSave // src/rdb.c:1273L
   -> fp = fopen(tmpfile,"w");
   -> rdbSaveRio(&rdb,&error,RDBFLAGS_NONE,rsi)
      -> snprintf(magic,sizeof(magic),"REDIS%04d",RDB_VERSION)
      -> rdbWriteRaw(rdb,magic,9)
      -> rdbSaveInfoAuxFields(rdb,rdbflags,rsi)
      -> for (j = 0; j < server.dbnum; j++)
         -> rdbSaveType(rdb,RDB_OPCODE_SELECTDB)
         -> rdbSaveLen(rdb,j)
         -> rdbSaveType(rdb,RDB_OPCODE_RESIZEDB)
         -> rdbSaveLen(rdb,db_size)
         -> rdbSaveLen(rdb,expires_size)
         -> while((de = dictNext(di)) != NULL)
            -> rdbSaveKeyValuePair(rdb,&key,o,expire)
      -> rdbSaveType(rdb,RDB_OPCODE_EOF)
      -> rioWrite(rdb,&cksum,8)
   -> fclose(fp)
   -> rename(tmpfile,filename)
```
