import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="notfound">
      <span className="notfound-code">404</span>
      <h1>Page not found</h1>
      <p>The page you are looking for does not exist or has moved.</p>
      <div className="flex">
        <Link to="/" className="btn btn-primary"><Home size={16} /> Go home</Link>
        <Link to="/app" className="btn btn-secondary">Open dashboard</Link>
      </div>
    </div>
  );
}
