import os
import json
import time
import redis
from database import SessionLocal, TaskModel

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
r = redis.Redis.from_url(REDIS_URL, decode_responses=True)

def update_task_status(task_id: int, status: str):
    db = SessionLocal()
    task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
    if task:
        task.status = status
        db.commit()
    db.close()

    r.hset(f"task:{task_id}", "status", status)
    r.delete(f"cache:task:{task_id}")

    payload = json.dumps({"id": task_id, "status": status})
    r.publish("TaskStatusChannel", payload)

def run_worker():
    print("[Worker] Запущен и ожидает задач в TaskQ...")
    while True:
        _, task_raw = r.brpop("TaskQ")
        task = json.loads(task_raw)
        task_id = task["id"]

        print(f"[Worker] Обработка задачи #{task_id}: {task['title']}")
        update_task_status(task_id, "IN_PROGRESS")

        time.sleep(4)

        update_task_status(task_id, "COMPLETED")
        print(f"[Worker] Задача #{task_id} завершена!")

if __name__ == "__main__":
    run_worker()
