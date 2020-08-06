var store = [{
        "title": "WSL tricks",
        "excerpt":"This post shares some WSL (Windows Subsystem for Linux) tricks. The Windows Subsystem for Linux lets developers run a GNU/Linux environment – including most command-line tools, utilities, and applications – directly on Windows, unmodified, without the overhead of a virtual machine. Tip: If you haven’t heard of WSL, you can...","categories": ["wsl"],
        "tags": [],
        "url": "https://uzxmx.github.io/wsl-tricks.html",
        "teaser": null
      },{
        "title": "Add or remove Java annotation at runtime",
        "excerpt":"Java is a language whose source files are compiled to bytecode. Unlike C/C++, we cannot use preprocessing directive such as #ifdef syntactically. Suppose there is such a case that normally a Java application runs with an annotation, but when it’s launched with some environment variable, then that annotation shouldn’t be...","categories": ["java"],
        "tags": [],
        "url": "https://uzxmx.github.io/add-or-remove-java-annotation-at-runtime.html",
        "teaser": null
      },{
        "title": "Renew SSL certificates inside and outside Kubernetes",
        "excerpt":"If you get an SSL certificate from Let’s Encrypt, and the certificate is deployed not only in a Kubernetes cluster, but also outside the cluster (e.g. an Nginx web server). Then when the certificate in Kubernetes cluster gets renewed, how can the same certificate outside Kubernetes cluster get renewed automatically?...","categories": ["kubernetes"],
        "tags": [],
        "url": "https://uzxmx.github.io/renew-certificates-inside-outside-kubernetes.html",
        "teaser": null
      },{
        "title": "Prometheus bootstrap internals",
        "excerpt":"Prometheus is a system and service monitoring system. It collects metrics from configured targets at given intervals, evaluates rule expressions, displays the results, and can trigger alerts if some condition is observed to be true. This series of articles try to dig deeply into Prometheus internals to help readers understand...","categories": ["prometheus"],
        "tags": [],
        "url": "https://uzxmx.github.io/prometheus-bootstrap-internals.html",
        "teaser": null
      },{
        "title": "Prometheus scrape internals",
        "excerpt":"Scrape is an action that Prometheus server fetches metrics data from a list of configured targets. The targets are also called exporters. Scrape discovery manager The scrape discovery manager is actually the service discovery manager. Here, finding the scrape targets is the same meaning as discovering services. At the beginning,...","categories": ["prometheus"],
        "tags": [],
        "url": "https://uzxmx.github.io/prometheus-scrape-internals.html",
        "teaser": null
      },{
        "title": "Prometheus TSDB internals",
        "excerpt":"Prometheus has local and remote storage. At the beginning, it creates a local storage, a remote storage, and a fanout storage. A fanout storage is like a wrapper storage that wraps a primary storage and multiple secondary storages, which proxies reads and writes through to the underlying. Internally, Prometheus uses...","categories": ["prometheus"],
        "tags": [],
        "url": "https://uzxmx.github.io/prometheus-tsdb-internals.html",
        "teaser": null
      },{
        "title": "Redis RDB internals",
        "excerpt":"This post aims to covering how Redis dumps in-memory data into a disk file. The version of Redis used is 6.0.5. First, let’s look at how Redis prepares for the dump. In main function, Redis initializes a global redisServer structure, registering a timer callback serverCron (should be scheduled per millisecond)...","categories": ["redis"],
        "tags": [],
        "url": "https://uzxmx.github.io/redis-rdb-internals.html",
        "teaser": null
      }]
