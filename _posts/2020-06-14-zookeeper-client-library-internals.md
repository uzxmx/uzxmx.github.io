---
title: ZooKeeper client library internals
date: 2020-06-14 20:05:00 +0800
categories: zookeeper
toc: true
---

This post aims to covering how ZooKeeper client library works internally. The
version of ZooKeeper used is 3.6.1.

## The topmost class

[ZooKeeper][ZooKeeper] is the public interface that a client can use to interact
with a ZooKeeper server (sending requests and getting responses). The most
notable features are as follows:

* Session establishment is asynchronous
* [Read-only
  mode](https://github.com/apache/zookeeper/blob/104dcb3e3fb464b30c5186d229e00af9f332524b/zookeeper-server/src/main/java/org/apache/zookeeper/ZooKeeper.java#L914) (useful in case of partitioning)
* Sync/Async requests

### Session establishment

When instantiating a [ZooKeeper][ZooKeeper], it creates a
[ClientCnxn][ClientCnxn] object, starts a sender thread and an event thread
(these two threads will be described in the following section) and then returns
immediately. So the session may or may not have been established at that moment.

### Sync/Async requests

[ZooKeeper][ZooKeeper] provides both synchronous and asynchronous methods to
send requests. The synchronous methods are implemented on top of the
asynchronous mechanism. They are backed by below `submitRequest` method. In this
method, after adding a new packet to the queue, the calling thread waits on the
packet for its finishing.

{% highlight java linenos start_line=1536
name=zookeeper-server/.../org/apache/zookeeper/ClientCnxn.java %}
public ReplyHeader submitRequest(
    RequestHeader h,
    Record request,
    Record response,
    WatchRegistration watchRegistration,
    WatchDeregistration watchDeregistration) throws InterruptedException {
    ReplyHeader r = new ReplyHeader();
    Packet packet = queuePacket(
        h,
        r,
        request,
        response,
        null,
        null,
        null,
        null,
        watchRegistration,
        watchDeregistration);
    synchronized (packet) {
        if (requestTimeout > 0) {
            // Wait for request completion with timeout
            waitForPacketFinish(r, packet);
        } else {
            // Wait for request completion infinitely
            while (!packet.finished) {
                packet.wait();
            }
        }
    }
    if (r.getErr() == Code.REQUESTTIMEOUT.intValue()) {
        sendThread.cleanAndNotifyState();
    }
    return r;
}
{% endhighlight %}

When using the asynchronous methods, a callback must be passed as an argument.
All the supported types of callbacks are defined in
[AsyncCallback][AsyncCallback].  Because the callback is executed in ZooKeeper
IO thread, we shouldn't perform expensive operations in the callback, otherwise,
the ZooKeeper client won't process other events in time.

## The core of IO handling

The class [ClientCnxn][ClientCnxn] is the core of client IO handling. All
operations on [ZooKeeper][ZooKeeper] are finally performed by it.  Two threads
are created and managed inside `ClientCnxn`, one is `SenderThread`, the other is
`EventThread`.

### Packets queue

Internally there are two queues for packets. One is
[`outgoingQueue`](https://github.com/apache/zookeeper/blob/release-3.6.1/zookeeper-server/src/main/java/org/apache/zookeeper/ClientCnxn.java#L152)
which stores packets ready to be sent. The other is
[`pendingQueue`](https://github.com/apache/zookeeper/blob/release-3.6.1/zookeeper-server/src/main/java/org/apache/zookeeper/ClientCnxn.java#L147)
which stores packets that have have been sent and are waiting for a response.

### SenderThread

The [`SenderThread`][SenderThread] repeatedly does the following:

* Connect to a ZooKeeper server unless connected
* Authenticate to the server if connected and required
* Send heart beats if connected
* Call the lower level socket implementation to proceed (poll and process IO
  events)

#### Lower level socket implementations

The `SenderThread` owns a `ClientCnxnSocket` which abstracts out the lower level
socket implementation. Two implementations are provided: `ClientCnxnSocketNIO`
and `ClientCnxnSocketNetty`.

Let's take `ClientCnxnSocketNIO` for an example. The main logic is `doIO`
method. Inside `doIO`, when `SocketChannel` is readable, available data will be
read into `incomingBuffer` which is a preallocated `ByteBuffer` (with fixed
buffer size). When `incomingBuffer` is full, if it is `lenBuffer` (which is also
a `ByteBuffer` but only accepts 4-bytes data which is the length of the incoming
message), it'll be used to to allocate a new `incomingBuffer` with that amount
of free space.

{% highlight java linenos start_line=66
name=zookeeper-server/.../org/apache/zookeeper/ClientCnxnSocketNIO.java %}
void doIO(Queue<Packet> pendingQueue, ClientCnxn cnxn) throws InterruptedException, IOException {
    ...
    if (sockKey.isReadable()) {
        int rc = sock.read(incomingBuffer);
        if (rc < 0) {
            throw new EndOfStreamException("Unable to read additional data from server sessionid 0x"
                                           + Long.toHexString(sessionId)
                                           + ", likely server has closed socket");
        }
        if (!incomingBuffer.hasRemaining()) {
            incomingBuffer.flip();
            if (incomingBuffer == lenBuffer) {
                recvCount.getAndIncrement();
                readLength();
            } else if (!initialized) {
                readConnectResult();
                enableRead();
                if (findSendablePacket(outgoingQueue, sendThread.tunnelAuthInProgress()) != null) {
                    // Since SASL authentication has completed (if client is configured to do so),
                    // outgoing packets waiting in the outgoingQueue can now be sent.
                    enableWrite();
                }
                lenBuffer.clear();
                incomingBuffer = lenBuffer;
                updateLastHeard();
                initialized = true;
            } else {
                sendThread.readResponse(incomingBuffer);
                lenBuffer.clear();
                incomingBuffer = lenBuffer;
                updateLastHeard();
            }
        }
    }
    ...
}
{% endhighlight %}

[ClientCnxn]: https://zookeeper.apache.org/doc/r3.6.1/apidocs/zookeeper-server/org/apache/zookeeper/ClientCnxn.html
[ZooKeeper]: https://zookeeper.apache.org/doc/r3.6.1/apidocs/zookeeper-server/org/apache/zookeeper/ZooKeeper.html
[AsyncCallback]: https://zookeeper.apache.org/doc/r3.6.1/apidocs/zookeeper-server/org/apache/zookeeper/AsyncCallback.html
[SenderThread]: https://github.com/apache/zookeeper/blob/104dcb3e3fb464b30c5186d229e00af9f332524b/zookeeper-server/src/main/java/org/apache/zookeeper/ClientCnxn.java#L857
