# Agent 须知（Chess & Cards）

1. **先读** [CONTEXT.md](CONTEXT.md) 与 [docs/GAME_MAP.md](docs/GAME_MAP.md)，再改代码。  
2. 游戏规则权威在 `services/games/<pkg>`，不要只改前端「看起来像规则」的展示。  
3. `goldenflower` ≠ zhajinhua；麻将五变体同属 `@cc/game-cs-mahjong`。  
4. 样式优先用 GAME_MAP / CSS 文件顶部索引定位；`styles.css` 与 `theme.css` 都要查。  
5. 单游戏热更见 [docs/运维手册-发布与热更新.md](docs/运维手册-发布与热更新.md)；**新增游戏**需正规发版，不要假设热更能注册新包。  
6. 用户规则：中文详细注释；单文件勿超过 1500 行（已超大的 CSS/麻将先加索引，拆分另议）。  
7. 不要主动 git commit / push，除非用户明确要求。
