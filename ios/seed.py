#!/usr/bin/env python3
"""Seeds a demo account for the App Store screenshots on a local backend; prints its token.
   ./seed.py http://localhost:3310 en   (never point this at production)"""
import json, random, sys, time, urllib.request
from datetime import date, timedelta

api, lang = sys.argv[1], sys.argv[2]
assert "todorant.com" not in api, "local backends only"

T = {
    "en": dict(partner="Alex Morgan", me="Sam Taylor", frog="Finish the quarterly report #work", today=["Team stand-up #work", "Pick up dry cleaning #home", "30 minutes of stretching #fitness"],
               done=["Answer client emails #work", "Morning run #fitness", "Water the plants #home"], tomorrow=["Prepare slides for Monday's demo #work", "Buy groceries for the week #home", "Read two chapters of “Deep Work” #reading"],
               later=["Dentist appointment", "Renew car insurance #home", "Plan the team offsite #work", "Swim 1 km #fitness"], month=["Repaint the balcony #home", "Sign up for a half marathon #fitness"],
               to_me="Review the launch checklist #work", by_me="Book the venue for Friday #work", tags=["work", "home", "fitness", "reading"]),
    "ru": dict(partner="Аня Смирнова", me="Саша Петров", frog="Закончить квартальный отчёт #работа", today=["Планёрка с командой #работа", "Забрать вещи из химчистки #дом", "30 минут растяжки #спорт"],
               done=["Ответить на письма клиентов #работа", "Утренняя пробежка #спорт", "Полить цветы #дом"], tomorrow=["Подготовить слайды к демо в понедельник #работа", "Купить продукты на неделю #дом", "Прочитать две главы «Deep Work» #книги"],
               later=["Записаться к стоматологу", "Продлить страховку машины #дом", "Спланировать выезд команды #работа", "Проплыть 1 км #спорт"], month=["Покрасить балкон #дом", "Записаться на полумарафон #спорт"],
               to_me="Проверить чек-лист запуска #работа", by_me="Забронировать зал на пятницу #работа", tags=["работа", "дом", "спорт", "книги"]),
    "uk": dict(partner="Оля Коваленко", me="Андрій Мельник", frog="Завершити квартальний звіт #робота", today=["Нарада з командою #робота", "Забрати речі з хімчистки #дім", "30 хвилин розтяжки #спорт"],
               done=["Відповісти на листи клієнтів #робота", "Ранкова пробіжка #спорт", "Полити квіти #дім"], tomorrow=["Підготувати слайди до демо в понеділок #робота", "Купити продукти на тиждень #дім", "Прочитати два розділи «Deep Work» #книги"],
               later=["Записатися до стоматолога", "Продовжити страховку авто #дім", "Спланувати виїзд команди #робота", "Пропливти 1 км #спорт"], month=["Пофарбувати балкон #дім", "Зареєструватися на напівмарафон #спорт"],
               to_me="Перевірити чек-лист запуску #робота", by_me="Забронювати залу на пʼятницю #робота", tags=["робота", "дім", "спорт", "книги"]),
    "it": dict(partner="Giulia Rossi", me="Marco Bianchi", frog="Finire il report trimestrale #lavoro", today=["Riunione con il team #lavoro", "Ritirare i vestiti in lavanderia #casa", "30 minuti di stretching #sport"],
               done=["Rispondere alle email dei clienti #lavoro", "Corsa mattutina #sport", "Annaffiare le piante #casa"], tomorrow=["Preparare le slide per la demo di lunedì #lavoro", "Fare la spesa per la settimana #casa", "Leggere due capitoli di “Deep Work” #lettura"],
               later=["Appuntamento dal dentista", "Rinnovare l'assicurazione dell'auto #casa", "Organizzare l'offsite del team #lavoro", "Nuotare 1 km #sport"], month=["Ridipingere il balcone #casa", "Iscriversi a una mezza maratona #sport"],
               to_me="Controllare la checklist del lancio #lavoro", by_me="Prenotare la sala per venerdì #lavoro", tags=["lavoro", "casa", "sport", "lettura"]),
    "es": dict(partner="Lucía García", me="Pablo Martín", frog="Terminar el informe trimestral #trabajo", today=["Reunión diaria del equipo #trabajo", "Recoger la ropa de la tintorería #casa", "30 minutos de estiramientos #deporte"],
               done=["Responder correos de clientes #trabajo", "Correr por la mañana #deporte", "Regar las plantas #casa"], tomorrow=["Preparar las diapositivas para la demo del lunes #trabajo", "Hacer la compra de la semana #casa", "Leer dos capítulos de «Deep Work» #lectura"],
               later=["Cita con el dentista", "Renovar el seguro del coche #casa", "Planear la salida del equipo #trabajo", "Nadar 1 km #deporte"], month=["Pintar el balcón #casa", "Inscribirse en una media maratón #deporte"],
               to_me="Revisar la lista del lanzamiento #trabajo", by_me="Reservar la sala para el viernes #trabajo", tags=["trabajo", "casa", "deporte", "lectura"]),
    "pt-br": dict(partner="Ana Souza", me="Lucas Oliveira", frog="Terminar o relatório trimestral #trabalho", today=["Reunião diária da equipe #trabalho", "Buscar roupas na lavanderia #casa", "30 minutos de alongamento #esporte"],
               done=["Responder e-mails de clientes #trabalho", "Corrida matinal #esporte", "Regar as plantas #casa"], tomorrow=["Preparar os slides da demo de segunda #trabalho", "Fazer as compras da semana #casa", "Ler dois capítulos de “Deep Work” #leitura"],
               later=["Consulta no dentista", "Renovar o seguro do carro #casa", "Planejar o offsite da equipe #trabalho", "Nadar 1 km #esporte"], month=["Pintar a varanda #casa", "Inscrever-se numa meia maratona #esporte"],
               to_me="Revisar o checklist do lançamento #trabalho", by_me="Reservar a sala para sexta #trabalho", tags=["trabalho", "casa", "esporte", "leitura"]),
}[lang]


def call(method, path, body=None, token=None):
    req = urllib.request.Request(api + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("token", token)
    return json.load(urllib.request.urlopen(req))


def oid():
    return "%08x" % int(time.time()) + "".join(random.choice("0123456789abcdef") for _ in range(16))


stamp = int(time.time() * 1000)
me = call("POST", "/v2/auth/signup", {"email": f"qa+demo-{lang}-{stamp}@example.com", "password": "password123"})
partner = call("POST", "/v2/auth/signup", {"email": f"qa+partner-{lang}-{stamp}@example.com", "password": "password123"})
tm, tp = me["token"], partner["token"]
call("POST", "/v2/delegation/accept", {"token": partner["delegateInviteToken"]}, tm)
call("POST", "/v2/delegation/accept", {"token": me["delegateInviteToken"]}, tp)


def sync(token, ops):
    return call("POST", "/v2/sync", {"ops": ops}, token)


now = int(time.time() * 1000)
sync(tp, [{"c": "user", "at": now, "set": {"name": T["partner"]}}])
work, home, fitness, reading = T["tags"]
ops = [
    {"c": "user", "at": now, "set": {"name": T["me"]}},
    {"c": "settings", "at": now, "set": {"language": lang, "preserveOrderByTime": True, "showTodayOnAddTodo": True}},
    {"c": "hero", "at": now, "set": {"points": 87}},
    {"c": "tag", "id": oid(), "at": now, "set": {"tag": work, "color": "#377DFF", "epic": True, "epicGoal": 20, "epicPoints": 13, "epicOrder": 0, "numberOfUses": 9}},
    {"c": "tag", "id": oid(), "at": now, "set": {"tag": fitness, "color": "#FF984C", "epic": True, "epicGoal": 10, "epicPoints": 6, "epicOrder": 1, "numberOfUses": 5}},
    {"c": "tag", "id": oid(), "at": now, "set": {"tag": home, "color": "#2DCA8C", "numberOfUses": 6}},
    {"c": "tag", "id": oid(), "at": now, "set": {"tag": reading, "color": "#AB81D6", "numberOfUses": 2}},
]


def day(d):
    return {"monthAndYear": d.isoformat()[:7], "date": d.isoformat()[8:]}


today = date.today()
order = 0
for text in T["done"]:
    ops.append({"c": "todo", "id": oid(), "at": now, "set": {"text": text, "completed": True, "order": order, **day(today)}})
    order += 1
ops.append({"c": "todo", "id": oid(), "at": now, "set": {"text": T["frog"], "frog": True, "order": 0, **day(today)}})
for i, text in enumerate(T["today"]):
    ops.append({"c": "todo", "id": oid(), "at": now, "set": {"text": text, "order": i + 1, **day(today), **({"time": "16:00"} if i == 0 else {})}})
for i, text in enumerate(T["tomorrow"]):
    ops.append({"c": "todo", "id": oid(), "at": now, "set": {"text": text, "order": i, "frog": i == 0, **day(today + timedelta(days=1))}})
for i, text in enumerate(T["later"]):
    d = today + timedelta(days=2 + i // 2)
    ops.append({"c": "todo", "id": oid(), "at": now, "set": {"text": text, "order": i % 2, **day(d), **({"time": "10:30"} if i == 0 else {})}})
next_month = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
for i, text in enumerate(T["month"]):
    ops.append({"c": "todo", "id": oid(), "at": now, "set": {"text": text, "order": i, "monthAndYear": next_month.isoformat()[:7]}})
ops.append({"c": "todo", "id": oid(), "at": now, "set": {"text": T["by_me"], "order": 0, "user": partner["_id"], "delegator": me["_id"], **day(today + timedelta(days=3))}})
sync(tm, ops)
sync(tp, [{"c": "todo", "id": oid(), "at": now, "set": {"text": T["to_me"], "order": 0, "user": me["_id"], "delegator": partner["_id"], **day(today + timedelta(days=1))}}])
print(tm)
