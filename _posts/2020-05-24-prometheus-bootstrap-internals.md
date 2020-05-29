---
title: Prometheus bootstrap internals
date: 2020-05-24 14:25:00 +0800
categories: prometheus
toc: false
---

Prometheus is a system and service monitoring system. It collects metrics from
configured targets at given intervals, evaluates rule expressions, displays the
results, and can trigger alerts if some condition is observed to be true.

This series of articles try to dig deeply into Prometheus internals to help readers
understand Prometheus well. The dig is based on Prometheus v2.18.1.

**Tip:** For more information about Prometheus, please visit
[here](https://github.com/prometheus/prometheus).
{: .notice--info}

## Actors

Prometheus starts up from `cmd/prometheus/main.go`. Inside `main` function, It
prepares a group of actors (functions) and runs them concurrently. Actors
include:

* Actor that handles application termination.
* Actor that manages scrape discovery.
* Actor that manages notification discovery.
* Actor that manages scrape.
* Actor that handles reloading configuration.
* Actor that handles initial configuration loading. After loading, It executes a
  list of `ApplyConfig` functions to initialize other actors.  `reloadReady`
  channel will also be closed to notify other actors to proceed.
* Actor that manages rules.
* Actor that handles TSDB.
* Actor that handles web requests.
* Actor that sends notifications.
