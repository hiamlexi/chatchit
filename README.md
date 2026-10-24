# Mini Chat on Kubernetes

Small chat app: two Node.js/Express microservices and a Redis database, running on Kubernetes. The app itself is simple on purpose. What matters here is the deployment (scaling each service on its own) .

## Architecture

```
                 browser
                    |
            NodePort :30080
                    |
          +---------v---------+   GET /validate    +--------------+
          |  message-service  | -----------------> | user-service |
          |  (2+ replicas)    |   (ClusterIP only) | (2+ replicas)|
          +---------+---------+                    +------+-------+
                    |                                     |
                    +------------------+------------------+
                                       |
                              +--------v--------+
                              |  redis (1 pod)  |
                              |  StatefulSet    |
                              |  + PVC, AOF on  |
                              +-----------------+
```

| Component         | Kubernetes object     | Exposure                         |                                                                                                                                 |
| ----------------- | --------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `message-service` | Deployment            | NodePort 30080                    |
| `user-service`    | Deployment            | ClusterIP (internal only)        |                                      |
| `redis`           | StatefulSet + 1Gi PVC | Headless service (internal only) |   |
