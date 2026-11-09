import fs from 'node:fs';

const css = `

/* =========================================================================
   SECTION 30: 彻底消除大厅与各视图全分辨率底部空白自适应体系 (Full-Viewport Zero Bottom Gap System)
   ========================================================================= */

/* 1. 视口骨架与大厅舞台 100% 充满，消除所有死黑留白 */
html,
body,
#root,
.landscape-app-root,
.landscape-stage-container,
.lobby--commercial-grade {
  width: 100% !important;
  height: 100% !important;
  height: 100dvh !important;
  max-height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  display: flex !important;
  flex-direction: column !important;
  box-sizing: border-box !important;
}

/* 2. 主舞台弹性占满剩余空间，直达屏幕底部，只留精致内边距 */
.commercial-lobby-stage {
  flex: 1 1 0% !important;
  height: 0 !important;
  min-height: 0 !important;
  max-height: none !important;
  width: 100% !important;
  display: flex !important;
  align-items: stretch !important;
  padding: 8px 18px 12px 18px !important;
  box-sizing: border-box !important;
  gap: 16px !important;
  overflow: hidden !important;
}

/* 3. 左侧专区快捷选项卡导航（弹性拉伸，美观居中或均匀分布） */
.commercial-nav-rail {
  height: 100% !important;
  min-height: 0 !important;
  flex-shrink: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  justify-content: flex-start !important;
  gap: 8px !important;
  box-sizing: border-box !important;
}

.commercial-nav-rail .nav-rail-item {
  flex: 0 0 auto !important;
}

/* 4. 中间游戏画卷视口与轨道（自适应高度 100%，卡片直抵舞台底部） */
.commercial-games-carousel-wrapper {
  flex: 1 1 0% !important;
  min-width: 0 !important;
  height: 100% !important;
  min-height: 0 !important;
  display: flex !important;
  position: relative !important;
  box-sizing: border-box !important;
}

.commercial-games-carousel-viewport {
  flex: 1 1 0% !important;
  min-width: 0 !important;
  height: 100% !important;
  min-height: 0 !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  box-sizing: border-box !important;
}

.commercial-games-strip {
  height: 100% !important;
  min-height: 0 !important;
  display: flex !important;
  align-items: stretch !important;
  gap: 16px !important;
  padding: 2px 4px 4px 4px !important;
  box-sizing: border-box !important;
}

/* 5. 游戏卡片纵向拉伸填满，告别半截卡片与下部死黑空白 */
.commercial-game-card {
  height: 100% !important;
  min-height: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  box-sizing: border-box !important;
  border-radius: 16px !important;
  overflow: hidden !important;
}

/* 6. 卡片海报区域弹性延伸，占满卡片除底栏之外的全部高度 */
.commercial-game-card__poster {
  flex: 1 1 0% !important;
  min-height: 0 !important;
  height: auto !important;
  width: 100% !important;
  position: relative !important;
  overflow: hidden !important;
  border-radius: 15px 15px 0 0 !important;
}

.commercial-game-card__poster img {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
  object-position: center 20% !important;
  display: block !important;
}

/* 7. 卡片底部信息栏固定紧贴卡片最底端 */
.commercial-game-card__meta {
  flex-shrink: 0 !important;
  padding: 10px 12px 12px 12px !important;
  box-sizing: border-box !important;
}

/* 8. 右侧首席动漫荷官展台全高度垂直延展，立绘人脸完整呈现 */
.commercial-dealer-companion-stand {
  height: 100% !important;
  min-height: 0 !important;
  flex-shrink: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  justify-content: space-between !important;
  gap: 8px !important;
  box-sizing: border-box !important;
}

.companion-portrait-wrapper {
  flex: 1 1 0% !important;
  min-height: 0 !important;
  height: auto !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  overflow: hidden !important;
  position: relative !important;
  border-radius: 16px !important;
  background: radial-gradient(ellipse 80% 50% at 50% 30%, rgba(243, 207, 122, 0.16), rgba(10, 14, 22, 0.75) 85%) !important;
  box-sizing: border-box !important;
}

.companion-portrait-wrapper img {
  width: 100% !important;
  height: 100% !important;
  max-width: 100% !important;
  max-height: 100% !important;
  object-fit: contain !important;
  object-position: top center !important;
  margin: 0 !important;
  filter: drop-shadow(0 8px 20px rgba(0, 0, 0, 0.75)) !important;
}

/* 9. 智能断点：较小屏幕/窗口自适应紧凑排版，杜绝拥挤变形 */
@media (max-width: 1200px) or (max-height: 600px) {
  .lobby-main-header {
    height: 50px !important;
    min-height: 50px !important;
    max-height: 50px !important;
    padding: 0 16px !important;
  }
  .commercial-lobby-stage {
    padding: 6px 12px 8px 12px !important;
    gap: 12px !important;
  }
  .commercial-nav-rail {
    width: 120px !important;
    flex: 0 0 120px !important;
  }
  .nav-rail-item {
    padding: 8px 10px !important;
    font-size: 12px !important;
  }
  .commercial-game-card {
    width: 225px !important;
    flex: 0 0 225px !important;
  }
  .commercial-dealer-companion-stand {
    width: 210px !important;
    flex: 0 0 210px !important;
  }
  .companion-speech-bubble {
    padding: 6px 8px !important;
  }
  .companion-name {
    font-size: 11px !important;
  }
  .bubble-content {
    font-size: 10.5px !important;
  }
  .btn-random-match {
    height: 34px !important;
    font-size: 11.5px !important;
  }
  .meta-title {
    font-size: 14.5px !important;
  }
  .meta-desc {
    font-size: 10.5px !important;
    -webkit-line-clamp: 1 !important;
  }
  .btn-quick-play-gold {
    height: 32px !important;
    font-size: 12px !important;
  }
  .btn-choose-room-subtle {
    height: 32px !important;
    font-size: 11px !important;
    padding: 0 10px !important;
  }
}

@media (max-height: 480px) {
  .lobby-main-header {
    height: 44px !important;
    min-height: 44px !important;
    max-height: 44px !important;
  }
  .commercial-lobby-stage {
    padding: 4px 8px 6px 8px !important;
    gap: 8px !important;
  }
  .commercial-nav-rail {
    width: 105px !important;
    flex: 0 0 105px !important;
  }
  .commercial-game-card {
    width: 195px !important;
    flex: 0 0 195px !important;
  }
  .commercial-dealer-companion-stand {
    width: 180px !important;
    flex: 0 0 180px !important;
  }
  .card-entry-info {
    padding: 2px 6px !important;
  }
  .entry-stakes-text {
    font-size: 9.5px !important;
  }
  .entry-speed-tag {
    font-size: 9px !important;
  }
}
`;

fs.appendFileSync('apps/lobby-web/src/theme.css', css, 'utf8');
console.log('Appended SECTION 30 successfully.');
