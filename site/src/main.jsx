import React from 'react';
import{createRoot}from'react-dom/client';
import{BrowserRouter}from'react-router-dom';
import App,{CrashBoundary} from './App.jsx';
import './styles.css';
import './pwa.js';
import './native-push.js';
createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><CrashBoundary><App/></CrashBoundary></BrowserRouter></React.StrictMode>);
