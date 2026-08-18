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

## 机器接口（供 AI/自动化使用）

`game.js` 加载后会公开入口 `window.MERGE_GAME_MACHINE`。AI 不需要模拟鼠标，也不需要从画布识图。

```js
const game = window.MERGE_GAME_MACHINE;
const state = game.observe();

if (state.canAct) {
  const action = game.legalActions()[0];
  game.act({ type: "drop", x: (action.minX + action.maxX) / 2 });
}
```

接口方法：

- `version()`：返回接口版本号。
- `observe()`：返回模式、得分、下一等级、危险状态、等级半径/分值，以及物体的 `id/level/x/y/vx/vy`。横坐标使用宽度为 400 的世界坐标，而不是 CSS 像素。
- `legalActions()`：可投放时返回 `drop` 及当前物体合法的世界坐标范围，否则返回空数组。
- `act({ type: "drop", x })`：提交一次落子并返回更新后的状态。
- `reset()`：重新开始游戏并返回新状态。

非法调用会抛出 `Error`，其 `code` 为：`INVALID_ARGUMENT`、`UNSUPPORTED_ACTION` 或 `ILLEGAL_ACTION`。
