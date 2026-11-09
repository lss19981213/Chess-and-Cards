import fs from 'node:fs';

const tweaks = `

/* 矢量闪电高对比度高光 */
.btn-bolt-svg {
  display: inline-block !important;
  vertical-align: middle !important;
  color: #ffffff !important;
  filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.95)) drop-shadow(0 0 10px rgba(255, 215, 0, 0.8)) !important;
}

/* 场次门槛单行保护，杜绝换行折叠 */
.card-entry-info {
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}

.entry-stakes-text {
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  flex: 1 1 auto !important;
}

.entry-speed-tag {
  flex-shrink: 0 !important;
}
`;

fs.appendFileSync('apps/lobby-web/src/theme.css', tweaks, 'utf8');
console.log('Appended tweaks successfully.');
