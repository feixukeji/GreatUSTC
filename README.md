# 通用合成游戏（合成中科大示例）

这是一个纯 HTML、CSS、JavaScript 的网页游戏，不需要 Node、构建工具或第三方游戏引擎，直接打开 `index.html` 即可运行。

## 更换主题

开发者通常只需修改 `game-config.js`，并把图片放到 `assetBase` 指向的目录。

```js
spawnLevelCount: 5,

levels: [
  { radius: 13, image: "ruc.svg" },
  { radius: 16, image: "tongji.svg" },
  // 按“最低级 → 最高级”继续添加
  { radius: 129, image: "ustc.svg" }
]
```

- `spawnLevelCount`：从前多少个等级中等概率随机投放，取值范围为 1～等级总数。
- `radius`：物理碰撞半径，在 6～199 之间，必须随等级严格递增。
- `image`：相对于 `assetBase` 的图片文件名，也可以是完整 URL，支持 PNG、JPG、WebP、SVG。
