---
title: Renew SSL certificates inside and outside Kubernetes
date: 2020-04-26 21:25:09 +0800
categories: kubernetes
---

If you get an SSL certificate from [Let's Encrypt][letsencrypt], and the
certificate is deployed not only in a [Kubernetes][kubernetes] cluster, but also
outside the cluster (e.g. an Nginx web server). Then when the certificate in
Kubernetes cluster gets renewed, how can the same certificate outside Kubernetes
cluster get renewed automatically?

For renewing SSL certificates automatically in Kubernetes cluster, we can rely
on [cert-manager][certmanager]. cert-manager is a Kubernetes add-on to automate
the management and issuance of TLS certificates from various issuing sources.
It will ensure certificates are valid and up to date periodically, and attempt
to renew certificates at an appropriate time before expiry.

For renewing SSL certificates outside Kubernetes cluster, we need to use some
event mechanism. When cert-manager renews a certificate, it generates a
Kubernetes event `Certificate:Issued`, we can watch for that event and trigger
the update of certificate outside Kubernetes cluster. Luckily, [Brigade][brigade] has
provided that feature.

This post assumes cert-manager has been setup in Kubernetes cluster, and only
outlines some key steps for updating certificates outside Kubernetes cluster.
For a whole detailed setup, you can visit [here](https://github.com/uzxmx/cert-manager-box).

### Setup brigade project

If you haven't setup brigade in Kubernetes cluster, please visit
[here](https://docs.brigade.sh/intro/quickstart/) to get started. Before
creating a brigade project, we need to create a directory and initialize it as a
git repository. Add a file `brigade.js` in the repository root with below
content.

```javascript
const { events } = require("brigadier")
const k8s = require("@kubernetes/client-node")
const axios = require("axios")

const kc = new k8s.KubeConfig()
kc.loadFromDefault()

const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api)
const k8sCustomObjectsApi = kc.makeApiClient(k8s.CustomObjectsApi)

const getCertificate = async (name, namespace) => {
  return await k8sCustomObjectsApi.getNamespacedCustomObject("cert-manager.io", "v1alpha2", namespace, "certificates", name);
}

const getSecret = async (name, namespace) => {
  return await k8sCoreApi.readNamespacedSecret(name, namespace);
}

events.on("Certificate:Issued", (e, p) => {
  let payload = JSON.parse(e.payload)
  let involvedObject = payload.involvedObject
  getCertificate(involvedObject.name, involvedObject.namespace).then(cert => {
    cert = cert.body
    let spec = cert.spec
    let commonName = spec.commonName
    if (commonName.startsWith("*.")) {
      commonName = commonName.substring(2, commonName.length)
    }

    getSecret(spec.secretName, cert.metadata.namespace).then(secret => {
      let data = secret.body.data

      let buf = new Buffer(data["tls.crt"], "base64")
      let certPem = buf.toString("ascii")
      buf = new Buffer(data["tls.key"], "base64")
      let keyPem = buf.toString("ascii")

      console.log("certPem: " + certPem)
      console.log("keyPem: " + keyPem)

      // TODO uncomment this if you want to trigger Gitlab CI pipeline through webhook.
      // axios.post('https://gitlab.exaple.com/api/v4/projects/1/trigger/pipeline', {
      //   token: 'YOUR_GITLAB_CI_TOKEN',
      //   ref: 'master',
      //   variables: {
      //     COMMON_NAME: commonName,
      //     TLS_CERT: data['tls.crt'],
      //     TLS_KEY: data['tls.key']
      //   }
      // })
    })
  })
})
```

The above snippets only output certificate and private key file. To update
certificate elsewhere, you can pass the certificate through webhook to Gitlab
CI, Jenkins or other CI service to synchronize certificates.

We also need to add a file `brigade.json` in the root directory to specify
dependencies imported in `brigade.js`.

```json
{
  "dependencies": {
    "axios": "0.19.0"
  }
}
```

Then we're good to create a brigade project.

### Watch for certificates issued events

[Brigade Kubernetes Gateway](https://github.com/uzxmx/brigade-k8s-gateway) can
watch for events in Kubernetes cluster, and send an event to brigade core, then
a brigade worker will be created to execute a project's `brigade.js` file.

Download the latest chart from [here](https://github.com/uzxmx/brigade-k8s-gateway/releases), and
use helm to install it. Specify below `values.yml` file. Replace YOUR_PROJECT_ID
with your real brigade project id.

```yaml
project: YOUR_PROJECT_ID
filters:
  - kind: Certificate
    reasons:
      - Issued
    action: accept
  - action: reject
```

### Test it out

When a certificate is renewed or a new certificate is created, a pod of a
brigade worker for the created project should be launched, and in the pod logs
there should be the contents of certificate and private key. For convenience,
you can even generate a fake `Certificate:Issued` event by using this
[utility](https://github.com/uzxmx/k8s-busybox).

```sh
$ curl -C- -L -O https://github.com/uzxmx/k8s-busybox/releases/download/v0.1.0/k8s-busybox-v0.1.0-linux-amd64.tar.gz
$ tar zxf k8s-busybox-v0.1.0-linux-amd64.tar.gz
$ ./linux-amd64/bin/k8s-eventgenerator --name YOUR_CERTIFICATE_NAME \
    --kind Certificate --reason Issued --message 'Fake event'
```

[letsencrypt]: https://letsencrypt.org/
[kubernetes]: https://kubernetes.io/
[certmanager]: https://github.com/jetstack/cert-manager
[brigade]: https://brigade.sh/
