import fs from 'node:fs';

let content = fs.readFileSync('apps/lobby-web/src/components/Lobby.tsx', 'utf8');

if (!content.includes('function IconBolt()')) {
  const iconDef = `function IconBolt() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="btn-bolt-svg" aria-hidden="true">
      <path d="M13 2L3 14h8l-2 8 11-12h-8l1-8z" />
    </svg>
  );
}

`;
  content = iconDef + content;
}

content = content.replace(/<span className="btn-bolt">[^<]*<\/span>/g, '<span className="btn-bolt"><IconBolt /></span>');

fs.writeFileSync('apps/lobby-web/src/components/Lobby.tsx', content, 'utf8');
console.log('Successfully updated Lobby.tsx with IconBolt.');
