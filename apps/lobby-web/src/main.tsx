import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './theme.css';

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 节点');

createRoot(container).render(<App />);
