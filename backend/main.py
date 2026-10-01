import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
import redis.asyncio as aioredis
from sqlalchemy.orm import Session
from database import init_db, SessionLocal, TaskModel
from pydantic import BaseModel

class UserProfile(BaseModel):
    user_id: str
    name: str
    email: str

app = FastAPI(title="Redis Course Project API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

async def get_redis():
    return aioredis.from_url(REDIS_URL, decode_responses=True)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.on_event("startup")
def startup_event():
    init_db()

@app.post("/api/visit")
async def track_visit(client_ip: str, redis=Depends(get_redis)):
    await redis.pfadd("unique_visitors", client_ip)
    count = await redis.pfcount("unique_visitors")
    return {"status": "ok", "unique_visitors": count}

@app.post("/api/tasks")
async def create_task(title: str, db: Session = Depends(get_db), redis=Depends(get_redis)):
    db_task = TaskModel(title=title, status="PENDING")
    db.add(db_task)
    db.commit()
    db.refresh(db_task)

    task_payload = json.dumps({"id": db_task.id, "title": db_task.title})
    await redis.lpush("TaskQ", task_payload)
    await redis.hset(f"task:{db_task.id}", mapping={"status": "PENDING", "title": db_task.title})
    
    return {"id": db_task.id, "title": db_task.title, "status": "PENDING"}

@app.get("/api/tasks/{task_id}")
async def get_task(task_id: int, db: Session = Depends(get_db), redis=Depends(get_redis)):
    cache_key = f"cache:task:{task_id}"
    cached_task = await redis.get(cache_key)
    if cached_task:
        return {"source": "redis_cache", "data": json.loads(cached_task)}

    task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    if not task:
        return {"error": "Not found"}

    task_data = {"id": task.id, "title": task.title, "status": task.status}
    await redis.setex(cache_key, 30, json.dumps(task_data))
    return {"source": "postgresql", "data": task_data}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    pubsub = redis.pubsub()
    await pubsub.subscribe("TaskStatusChannel")

    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                await websocket.send_text(message["data"])
    except WebSocketDisconnect:
        await pubsub.unsubscribe("TaskStatusChannel")
        await redis.close()
@app.post("/api/users")
async def create_user(profile: UserProfile, redis=Depends(get_redis)):
    user_key = f"user:{profile.user_id}"
    
    await redis.hset(user_key, mapping={"name": profile.name, "email": profile.email})
    
    await redis.setex(f"cache:user:{profile.user_id}", 60, json.dumps({"name": profile.name, "email": profile.email}))
    
    log_key = f"logs:{profile.user_id}"
    await redis.lpush(log_key, f"Создан профиль: {profile.name}")
    await redis.ltrim(log_key, 0, 9)
    
    return {"status": "ok", "message": "Профиль успешно создан"}

@app.get("/api/users/{user_id}")
async def get_user(user_id: str, redis=Depends(get_redis)):
    cached = await redis.get(f"cache:user:{user_id}")
    if cached:
        return {"source": "redis_cache", "data": json.loads(cached)}
    
    user_data = await redis.hgetall(f"user:{user_id}")
    if not user_data:
        return {"error": "Пользователь не найден"}
        
    return {"source": "redis_hash", "data": user_data}

@app.post("/api/action")
async def perform_action(user_id: str, redis=Depends(get_redis)):
    limit_key = f"ratelimit:{user_id}"
    requests_count = await redis.get(limit_key)
    
    if requests_count and int(requests_count) >= 5:
        from fastapi import HTTPException
        raise HTTPException(status_code=429, detail="Превышен лимит запросов (Rate Limit)")
    
    pipe = redis.pipeline()
    await pipe.incr(limit_key)
    if not requests_count:
        await pipe.expire(limit_key, 60)
    await pipe.execute()
    
    log_key = f"logs:{user_id}"
    await redis.lpush(log_key, "Выполнено действие под защитой Rate Limit")
    await redis.ltrim(log_key, 0, 9)
    
    return {"status": "ok", "message": "Действие выполнено"}

@app.get("/api/logs/{user_id}")
async def get_user_logs(user_id: str, redis=Depends(get_redis)):
    logs = await redis.lrange(f"logs:{user_id}", 0, -1)
    return {"user_id": user_id, "history": logs}