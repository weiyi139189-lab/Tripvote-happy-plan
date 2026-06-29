# TripVote Cloud Deploy

这个目录已经可以作为一个小型云服务部署。

## 推荐方式：Render

1. 把 `outputs/trip-planner-prototype` 这个目录作为一个 Git 仓库推到 GitHub。
2. 打开 Render，选择 `New` -> `Blueprint`。
3. 连接这个仓库，Render 会自动读取 `render.yaml`。
4. 创建服务后，等待部署完成。
5. 拿到 Render 分配的 `https://...onrender.com` 链接，发给团队成员。

## 数据保存

投票、成员、新增目的地会写入：

```text
/data/collab-state.json
```

Render 配置里已经挂了 1GB 持久盘，服务重启后数据仍会保留。

## 本地运行

```bash
python3 collab_server.py
```

默认端口是 `4180`，也可以由云服务通过 `PORT` 环境变量指定。

