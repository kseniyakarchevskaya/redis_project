import React, { useState, useEffect } from 'react';
import './App.css';

export default function App() {
  // Состояния аналитики и задач
  const [uniqueVisitors, setUniqueVisitors] = useState(0);
  const [taskTitle, setTaskTitle] = useState('');
  const [tasks, setTasks] = useState([]);

  // Состояния для работы с профилями (Hashes) и логами (Lists)
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [profileInfo, setProfileInfo] = useState(null);
  const [profileMessage, setProfileMessage] = useState('');
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    fetch('http://localhost:8000/api/visit?client_ip=' + Math.random(), { method: 'POST' })
      .then(res => res.json())
      .then(data => setUniqueVisitors(data.unique_visitors))
      .catch(err => console.error('Ошибка визитов:', err));

    const ws = new WebSocket('ws://localhost:8000/ws');
    ws.onmessage = (event) => {
      try {
        const updatedTask = JSON.parse(event.data);
        setTasks(prev => prev.map(t => t.id === updatedTask.id ? { ...t, status: updatedTask.status } : t));
      } catch (err) {
        console.error('Ошибка парсинга WS:', err);
      }
    };

    return () => ws.close();
  }, []);

  const handleAddTask = async () => {
    if (!taskTitle.trim()) return;
    try {
      const res = await fetch(`http://localhost:8000/api/tasks?title=${encodeURIComponent(taskTitle)}`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error();
      const newTask = await res.json();
      setTasks(prev => [...prev, newTask]);
      setTaskTitle('');
    } catch (err) {
      console.error('Не удалось добавить задачу');
    }
  };

  const handleRegisterUser = async () => {
    if (!userId || !name || !email) return;
    try {
      const res = await fetch('http://localhost:8000/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, name, email })
      });
      const data = await res.json();
      setProfileMessage(data.message || 'Профиль сохранен!');
      fetchLogs();
    } catch (err) {
      setProfileMessage('Ошибка сохранения профиля');
    }
  };

  const handleGetProfile = async () => {
    if (!userId) return;
    try {
      const res = await fetch(`http://localhost:8000/api/users/${userId}`);
      const data = await res.json();
      setProfileInfo(data);
    } catch (err) {
      console.error('Ошибка получения профиля');
    }
  };

  const fetchLogs = async () => {
    if (!userId) return;
    try {
      const res = await fetch(`http://localhost:8000/api/logs/${userId}`);
      const data = await res.json();
      setLogs(data.history || []);
    } catch (err) {
      console.error('Ошибка получения логов');
    }
  };

  const handleTriggerAction = async () => {
    if (!userId) {
      alert('Укажите ID пользователя!');
      return;
    }
    try {
      const res = await fetch(`http://localhost:8000/api/action?user_id=${userId}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);
      alert(data.message);
      fetchLogs();
    } catch (err) {
      alert(err.message || 'Превышен лимит запросов (Rate Limit 5 раз/мин)!');
    }
  };

  const getStatusStyle = (status) => {
    if (status === 'COMPLETED') return { backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', borderColor: '#22c55e' };
    if (status === 'IN_PROGRESS') return { backgroundColor: 'rgba(234, 179, 8, 0.15)', color: '#facc15', borderColor: '#eab308' };
    return { backgroundColor: 'rgba(156, 163, 175, 0.15)', color: '#9ca3af', borderColor: '#9ca3af' };
  };

  return (
    <div className="app-container">
      <h2 className="app-title">Redis Enterprise Dashboard</h2>
      
      <div className="visitors-badge">
        🌐 Уникальных посетителей (HyperLogLog): <b>{uniqueVisitors}</b>
      </div>
      <div className="card-section">
        <h3 className="section-title">1. Профили (Hashes + TTL Кэширование)</h3>
        <div className="form-grid">
          <input type="text" className="task-input" placeholder="ID пользователя (например: 1)" value={userId} onChange={e => setUserId(e.target.value)} />
          <input type="text" className="task-input" placeholder="Имя" value={name} onChange={e => setName(e.target.value)} />
          <input type="email" className="task-input" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="btn-group" style={{ marginTop: '10px' }}>
          <button className="task-button" onClick={handleRegisterUser}>Сохранить профиль</button>
          <button className="task-button secondary" onClick={handleGetProfile}>Получить (Кэш/Hash)</button>
        </div>
        {profileMessage && <p className="info-text">{profileMessage}</p>}
        
        {profileInfo && (
          <div className="result-box">
            <span style={{ fontSize: '12px', color: '#818cf8' }}>Источник: {profileInfo.source}</span>
            <pre style={{ margin: '5px 0 0', fontSize: '13px' }}>{JSON.stringify(profileInfo.data, null, 2)}</pre>
          </div>
        )}
      </div>

      <div className="card-section">
        <h3 className="section-title">2. Защита запросов и Журнал (Lists + Rate Limit)</h3>
        <button className="task-button warning" onClick={handleTriggerAction}>
          Выполнить действие (Лимит: 5 раз/мин)
        </button>

        <div style={{ marginTop: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>Журнал действий пользователя (List):</h4>
          <button onClick={fetchLogs} style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: '12px' }}>Обновить</button>
        </div>
        <ul className="log-list">
          {logs.length === 0 ? <li className="log-item" style={{ color: '#6b7280' }}>Нет записей в журнале</li> : logs.map((log, idx) => (
            <li key={idx} className="log-item"><span>#{idx + 1}</span> {log}</li>
          ))}
        </ul>
      </div>
      <div className="card-section">
        <h3 className="section-title">3. Очередь задач (Pub/Sub + Workers)</h3>
        <div className="task-form">
          <input
            type="text"
            className="task-input"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Название новой задачи..."
          />
          <button className="task-button" onClick={handleAddTask}>Добавить</button>
        </div>

        <ul className="task-list">
          {tasks.map(t => (
            <li key={t.id} className="task-item" style={{ borderLeft: `5px solid ${getStatusStyle(t.status).borderColor}` }}>
              <span className="task-content">
                <span className="task-id">#{t.id}</span> 
                <span>{t.title}</span>
              </span>
              <span className="task-status" style={getStatusStyle(t.status)}>
                {t.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}