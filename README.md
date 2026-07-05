# IPTV M3U Manager

一个适合部署到 VPS 的 IPTV M3U 管理服务。它可以定时抓取一个或多个远程 M3U 地址，自动合并重复频道，并保留同一频道的多条线路。

## 功能

- Docker Compose 一键部署。
- 默认端口 `3080`。
- 启动时立即更新，之后每 2 小时自动更新一次。
- 多个 M3U 源统一归并，同名频道只显示一个。
- 同一频道保留多条线路，可在网页里自由选择。
- 提供去重后的播放列表地址 `/playlist.m3u`。

## 配置源

编辑 `config/sources.json`：

```json
[
  {
    "name": "Chongqing Source",
    "url": "http://iptv.cqshushu.com/index.php?s=nwleGqYlX1QGiI3Av2MM8A&t=multicast&channels=1&format=m3u"
  }
]
```

添加多个源时，继续往数组里追加：

```json
[
  {
    "name": "Source A",
    "url": "https://example.com/a.m3u"
  },
  {
    "name": "Source B",
    "url": "https://example.com/b.m3u"
  }
]
```

## 部署到 VPS

在 VPS 上安装 Docker 和 Docker Compose 后，把本项目上传到 VPS，例如放到 `/opt/iptv-manager`。

进入目录：

```bash
cd /opt/iptv-manager
```

启动：

```bash
docker compose up -d --build
```

查看日志：

```bash
docker compose logs -f
```

访问管理页：

```text
http://你的VPS-IP:3080
```

IPTV 播放器里填写：

```text
http://你的VPS-IP:3080/playlist.m3u
```

## 常用接口

- `GET /`：Web 管理页。
- `GET /playlist.m3u`：去重后的播放列表。
- `GET /api/channels`：频道和线路 JSON。
- `GET /api/status`：刷新状态和源状态。
- `POST /api/refresh`：手动刷新。
- `GET /play/:channelId?source=0`：播放指定频道线路。

## 更新源配置

修改 `config/sources.json` 后，可以在网页点击刷新，也可以重启容器：

```bash
docker compose restart
```

服务会继续每 2 小时自动刷新一次。
