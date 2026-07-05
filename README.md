# IPTV M3U Manager

一个适合部署到 VPS 的 IPTV M3U 管理服务。它可以从网页填写一个或多个远程 M3U 采集地址，自动合并重复频道，并输出你自己的去重 M3U 地址。

## 功能

- Docker Compose 一键部署。
- 默认端口 `3080`。
- 在网页里新增、修改、删除采集源。
- 保存采集源后立即刷新。
- 启动时立即更新，之后每 2 小时自动更新一次。
- 多个 M3U 源统一归并，同名频道只显示一个。
- 同一频道保留多条线路，可在网页里自由选择。
- 提供去重后的播放列表地址 `/playlist.m3u`。
- 提供电视 APP 多信号源播放列表地址 `/playlist-sources.m3u`。
- 提供 JSON 嵌套多源地址 `/playlist.json`。

## 部署到 VPS

下面以 `/root/iptv` 为例：

```bash
cd /root
git clone https://github.com/zjm629/iptv.git
cd /root/iptv
docker compose up -d --build
```

如果 VPS 开了防火墙，放行端口：

```bash
ufw allow 3080/tcp
```

云服务器控制台里的安全组也需要放行 `3080` 端口。

## 使用

打开管理页：

```text
http://你的VPS-IP:3080
```

在页面的“采集源”区域填写：

- 名称：可选，例如 `重庆源`
- M3U 地址：必填，例如 `http://example.com/list.m3u`

可以添加多个采集源。点击“保存并刷新”后，服务会写入配置并立即抓取频道。

IPTV 播放器里填写你的输出地址：

```text
http://你的VPS-IP:3080/playlist.m3u
```

如果你的电视 APP 支持“信号源”菜单，建议填写多信号源地址：

```text
http://你的VPS-IP:3080/playlist-sources.m3u
```

这个地址会把同一个频道的多条线路输出为同名、同 `tvg-id` 的多条记录，方便播放器识别为同频道的多个信号源。

如果你的 APP 支持 JSON 频道源，可以尝试：

```text
http://你的VPS-IP:3080/playlist.json
```

这个地址每个频道只出现一次，频道对象里包含 `urls` 数组和 `sources` 详细线路数组。

## 常用命令

进入项目目录：

```bash
cd /root/iptv
```

查看日志：

```bash
docker compose logs -f
```

重启：

```bash
docker compose restart
```

停止：

```bash
docker compose down
```

更新代码：

```bash
git pull
docker compose up -d --build
```

## 常用接口

- `GET /`：Web 管理页。
- `GET /playlist.m3u`：去重后的播放列表。
- `GET /playlist-sources.m3u`：同频道多信号源播放列表。
- `GET /playlist.json`：JSON 嵌套多源播放列表。
- `GET /api/sources`：当前采集源。
- `PUT /api/sources`：保存采集源并刷新。
- `GET /api/channels`：频道和线路 JSON。
- `GET /api/status`：刷新状态和源状态。
- `POST /api/refresh`：手动刷新。
- `GET /play/:channelId?source=0`：播放指定频道线路。

## 配置文件

网页保存的采集源会写入：

```text
config/sources.json
```

这个目录已经通过 `docker-compose.yml` 挂载到容器里，所以容器重建后配置仍会保留。
