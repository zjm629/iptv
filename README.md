# IPTV M3U Manager

一个适合部署到 VPS 的 IPTV 管理服务。它可以从网页填写一个或多个远程 M3U 采集地址，自动合并重复频道，并输出适合电视软件使用的播放源。

## 功能

- Docker Compose 一键部署。
- 默认端口 `3080`。
- 网页新增、修改、删除采集源。
- 保存采集源后立即刷新。
- 启动时立即更新，之后每 2 小时自动更新一次。
- 多个 M3U 源统一归并，同名频道只显示一个。
- 同一频道保留多条线路。
- 网页可隐藏/恢复频道。
- 网页可设置频道排序号，也可上移/下移/置顶频道。
- 网页可维护自定义分类、调整分类顺序，并给频道选择一个或多个分类。
- 网页可设置某个频道的默认线路。
- 网页可禁用/启用某条线路。
- 网页可打开测试播放器，快速检查某条线路是否可播。
- 输出 TVBox/影视仓常用的 TXT 单行多源格式 `/live.txt`。
- 额外输出标准 M3U 格式 `/live.m3u`，方便电脑端软件播放。

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

点击“保存并刷新”后，服务会写入配置并立即抓取频道。

## 推荐播放地址

电视仓/影视仓优先测试：

```text
http://你的VPS-IP:3080/live.txt
```

电脑端软件如果更喜欢标准 M3U，可以测试：

```text
http://你的VPS-IP:3080/live.m3u
```

`/live.txt` 格式类似：

```text
推荐频道,#genre#
CCTV1 综合,http://源1#http://源2#http://源3

央视频道,#genre#
CCTV1 综合,http://源1#http://源2#http://源3

卫视频道,#genre#
湖南卫视,http://源1#http://源2
```

`/live.m3u` 格式类似：

```text
#EXTM3U
#EXTINF:-1 tvg-name="CCTV1" group-title="央视频道",CCTV1
http://源1#http://源2#http://源3
```

## 频道管理

在网页频道列表里可以操作：

- `隐藏`：该频道在网页上显示删除线，并且不会出现在 `/live.txt` 和 `/live.m3u`。
- `恢复`：恢复已隐藏频道。
- `序号`：手动设置频道排序号，数字越小越靠前；留空则跟在已编号频道后面。
- `分类`：用复选框给频道选择一个或多个分类，例如 `推荐频道`、`央视频道`、`卫视频道`。
- `置顶` / `上移` / `下移`：辅助调整同序号或未编号频道的默认顺序。
- `设为默认`：把该线路放到这个频道的第一个源。
- `禁用` / `启用`：控制某条线路是否参与输出。
- `测试播放`：打开网页播放器测试当前线路。浏览器通常支持 `.m3u8`、`.mp4` 等格式；`http://.../rtp/...`、`http://.../udp/...` 或 `.ts` 这类 MPEG-TS/组播代理流会通过 `mpegts.js` 尝试播放；真正的 `rtp://`、`udp://`、`rtsp://` 仍然通常需要电视端验证。

分类区域可以新增、删除或上移/下移分类。`推荐频道` 固定存在并排在第一位；播放软件打开 `/live.txt` 时默认会显示 `推荐频道`，其它频道需要点击左侧对应分类查看。分类顺序就是 `/live.txt` 的分组输出顺序。原始采集源里的默认分组不会再直接用于 `/live.txt`。

如果多个频道填写相同序号，会保持当前默认相对顺序，方便把后面的频道插入到同一个序号段里。隐藏频道会自动排到网页列表后面，并且不参与输出排序。

这些设置会保存到：

```text
config/channel-overrides.json
```

Docker 重建后仍会保留。

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
- `GET /live.txt`：推荐给电视仓/影视仓的 TXT 单行多源播放源。
- `GET /live.m3u`：推荐给电脑端播放器的标准 M3U 多源播放源。
- `GET /playlist.m3u`：去重后的标准 M3U 播放列表。
- `GET /playlist-sources.m3u`：同频道多信号源 M3U 播放列表。
- `GET /api/sources`：当前采集源。
- `PUT /api/sources`：保存采集源并刷新。
- `GET /api/channels`：频道和线路 JSON。
- `GET /api/categories`：当前自定义分类。
- `PUT /api/categories`：保存自定义分类。
- `PUT /api/channels/:channelId/override`：保存频道隐藏、排序号、分类、默认线路、禁用线路。
- `POST /api/channels/:channelId/move`：置顶、上移或下移频道。
- `GET /api/status`：刷新状态和源状态。
- `POST /api/refresh`：手动刷新。
- `GET /player/:channelId?source=0`：网页测试播放器。
- `GET /stream/:channelId?source=0`：网页测试播放器使用的 HTTP/HTTPS 流代理，主要用于 MPEG-TS/组播代理流。
- `GET /play/:channelId?source=0`：播放指定频道线路。

## 配置文件

网页保存的采集源会写入：

```text
config/sources.json
```

频道隐藏、排序、分类和线路偏好会写入：

```text
config/channel-overrides.json
```

这些目录已经通过 `docker-compose.yml` 挂载到容器里，所以容器重建后配置仍会保留。
