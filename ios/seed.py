#!/usr/bin/env python3
"""Seeds a demo account for the App Store screenshots on a local backend; prints its token.
   ./seed.py http://localhost:3310 en   (never point this at production)
   ./seed.py http://localhost:3310 en --frog   prints the frog's text instead (the tour waits for it)
   ./seed.py http://localhost:3310 en --add    prints the text the tour types into a new todo
   ./seed.py http://localhost:3310 en --texts  prints all the texts as JSON (scripts/shots/android.py)"""
import ipaddress, json, random, sys, time, urllib.parse, urllib.request
from datetime import date, timedelta

api, lang = sys.argv[1], sys.argv[2]
# this machine, a private network, or the Android emulator's host (10.0.2.2) only
host = (urllib.parse.urlsplit(api).hostname or "").lower()
try:
    local = ipaddress.ip_address(host).is_private
except ValueError:
    local = host == "localhost"
if not local:
    sys.exit(f"{api}: local backends only")

# What the tour types into a new todo
ADD = {
    "en": "Call Mom about the weekend #", "ru": "Позвонить маме насчёт выходных #", "uk": "Подзвонити мамі щодо вихідних #",
    "it": "Chiamare la mamma per il weekend #", "es": "Llamar a mamá por el fin de semana #", "pt-br": "Ligar para a mãe sobre o fim de semana #",
    "pt-pt": "Ligar à mãe por causa do fim de semana #", "de": "Mama wegen des Wochenendes anrufen #", "fr": "Appeler maman pour le week-end #",
    "nl": "Mama bellen over het weekend #", "pl": "Zadzwonić do mamy w sprawie weekendu #", "tr": "Hafta sonu için annemi ara #",
    "sv": "Ringa mamma om helgen #", "id": "Telepon Ibu soal akhir pekan #", "vi": "Gọi cho mẹ về chuyện cuối tuần #",
    "ja": "週末のことで母に電話する #", "ko": "주말 일로 엄마에게 전화하기 #", "zh-hans": "周末的事给妈妈打个电话 #",
    "zh-hant": "打電話跟媽媽討論週末的事 #", "ar": "الاتصال بأمي بخصوص عطلة نهاية الأسبوع #", "hi": "वीकेंड के बारे में माँ को फ़ोन करना #",
    "th": "โทรหาแม่เรื่องวันหยุดสุดสัปดาห์ #",
}

T = {
    "en": dict(partner="Alex Morgan", me="Sam Taylor", frog="Finish the quarterly report #work", today=["Team stand-up #work", "Pick up dry cleaning #home", "30 minutes of stretching #fitness"],
               done=["Answer client emails #work", "Morning run #fitness", "Water the plants #home"], tomorrow=["Prepare slides for Monday's demo #work", "Buy groceries for the week #home", "Read two chapters of “Deep Work” #reading"],
               later=["Dentist appointment", "Renew car insurance #home", "Plan the team offsite #work", "Swim 1 km #fitness"], month=["Repaint the balcony #home", "Sign up for a half marathon #fitness"],
               inbox=["Send the contract to legal #work", "Pick a date for the team dinner"], to_me="Review the launch checklist #work", by_me="Book the venue for Friday #work", tags=["work", "home", "fitness", "reading"]),
    "ru": dict(partner="Аня Смирнова", me="Саша Петров", frog="Закончить квартальный отчёт #работа", today=["Планёрка с командой #работа", "Забрать вещи из химчистки #дом", "30 минут растяжки #спорт"],
               done=["Ответить на письма клиентов #работа", "Утренняя пробежка #спорт", "Полить цветы #дом"], tomorrow=["Подготовить слайды к демо в понедельник #работа", "Купить продукты на неделю #дом", "Прочитать две главы «Deep Work» #книги"],
               later=["Записаться к стоматологу", "Продлить страховку машины #дом", "Спланировать выезд команды #работа", "Проплыть 1 км #спорт"], month=["Покрасить балкон #дом", "Записаться на полумарафон #спорт"],
               inbox=["Отправить договор юристам #работа", "Выбрать дату командного ужина"], to_me="Проверить чек-лист запуска #работа", by_me="Забронировать зал на пятницу #работа", tags=["работа", "дом", "спорт", "книги"]),
    "uk": dict(partner="Оля Коваленко", me="Андрій Мельник", frog="Завершити квартальний звіт #робота", today=["Нарада з командою #робота", "Забрати речі з хімчистки #дім", "30 хвилин розтяжки #спорт"],
               done=["Відповісти на листи клієнтів #робота", "Ранкова пробіжка #спорт", "Полити квіти #дім"], tomorrow=["Підготувати слайди до демо в понеділок #робота", "Купити продукти на тиждень #дім", "Прочитати два розділи «Deep Work» #книги"],
               later=["Записатися до стоматолога", "Продовжити страховку авто #дім", "Спланувати виїзд команди #робота", "Пропливти 1 км #спорт"], month=["Пофарбувати балкон #дім", "Зареєструватися на напівмарафон #спорт"],
               inbox=["Надіслати договір юристам #робота", "Обрати дату командної вечері"], to_me="Перевірити чек-лист запуску #робота", by_me="Забронювати залу на пʼятницю #робота", tags=["робота", "дім", "спорт", "книги"]),
    "it": dict(partner="Giulia Rossi", me="Marco Bianchi", frog="Finire il report trimestrale #lavoro", today=["Riunione con il team #lavoro", "Ritirare i vestiti in lavanderia #casa", "30 minuti di stretching #sport"],
               done=["Rispondere alle email dei clienti #lavoro", "Corsa mattutina #sport", "Annaffiare le piante #casa"], tomorrow=["Preparare le slide per la demo di lunedì #lavoro", "Fare la spesa per la settimana #casa", "Leggere due capitoli di “Deep Work” #lettura"],
               later=["Appuntamento dal dentista", "Rinnovare l'assicurazione dell'auto #casa", "Organizzare l'offsite del team #lavoro", "Nuotare 1 km #sport"], month=["Ridipingere il balcone #casa", "Iscriversi a una mezza maratona #sport"],
               inbox=["Inviare il contratto all'ufficio legale #lavoro", "Scegliere la data della cena di team"], to_me="Controllare la checklist del lancio #lavoro", by_me="Prenotare la sala per venerdì #lavoro", tags=["lavoro", "casa", "sport", "lettura"]),
    "es": dict(partner="Lucía García", me="Pablo Martín", frog="Terminar el informe trimestral #trabajo", today=["Reunión diaria del equipo #trabajo", "Recoger la ropa de la tintorería #casa", "30 minutos de estiramientos #deporte"],
               done=["Responder correos de clientes #trabajo", "Correr por la mañana #deporte", "Regar las plantas #casa"], tomorrow=["Preparar las diapositivas para la demo del lunes #trabajo", "Hacer la compra de la semana #casa", "Leer dos capítulos de «Deep Work» #lectura"],
               later=["Cita con el dentista", "Renovar el seguro del coche #casa", "Planear la salida del equipo #trabajo", "Nadar 1 km #deporte"], month=["Pintar el balcón #casa", "Inscribirse en una media maratón #deporte"],
               inbox=["Enviar el contrato a legal #trabajo", "Elegir fecha para la cena del equipo"], to_me="Revisar la lista del lanzamiento #trabajo", by_me="Reservar la sala para el viernes #trabajo", tags=["trabajo", "casa", "deporte", "lectura"]),
    "pt-br": dict(partner="Ana Souza", me="Lucas Oliveira", frog="Terminar o relatório trimestral #trabalho", today=["Reunião diária da equipe #trabalho", "Buscar roupas na lavanderia #casa", "30 minutos de alongamento #esporte"],
               done=["Responder e-mails de clientes #trabalho", "Corrida matinal #esporte", "Regar as plantas #casa"], tomorrow=["Preparar os slides da demo de segunda #trabalho", "Fazer as compras da semana #casa", "Ler dois capítulos de “Deep Work” #leitura"],
               later=["Consulta no dentista", "Renovar o seguro do carro #casa", "Planejar o offsite da equipe #trabalho", "Nadar 1 km #esporte"], month=["Pintar a varanda #casa", "Inscrever-se numa meia maratona #esporte"],
               inbox=["Enviar o contrato para o jurídico #trabalho", "Escolher a data do jantar da equipe"], to_me="Revisar o checklist do lançamento #trabalho", by_me="Reservar a sala para sexta #trabalho", tags=["trabalho", "casa", "esporte", "leitura"]),
    # Tags take Latin and Cyrillic letters only (HASH_CHARS in the apps), so the other scripts use English ones
    "pt-pt": dict(partner="Inês Ferreira", me="Tiago Santos", frog="Terminar o relatório trimestral #trabalho", today=["Reunião de equipa #trabalho", "Ir buscar a roupa à lavandaria #casa", "30 minutos de alongamentos #desporto"],
                  done=["Responder aos e-mails dos clientes #trabalho", "Corrida matinal #desporto", "Regar as plantas #casa"], tomorrow=["Preparar os diapositivos para a demo de segunda #trabalho", "Fazer as compras da semana #casa", "Ler dois capítulos de «Deep Work» #leitura"],
                  later=["Consulta no dentista", "Renovar o seguro do carro #casa", "Planear o encontro da equipa #trabalho", "Nadar 1 km #desporto"], month=["Pintar a varanda #casa", "Inscrever-me numa meia maratona #desporto"],
                  inbox=["Enviar o contrato ao departamento jurídico #trabalho", "Escolher a data do jantar de equipa"], to_me="Rever a checklist do lançamento #trabalho", by_me="Reservar a sala para sexta-feira #trabalho", tags=["trabalho", "casa", "desporto", "leitura"]),
    "de": dict(partner="Lena Schmidt", me="Jonas Weber", frog="Den Quartalsbericht fertigstellen #arbeit", today=["Team-Meeting am Morgen #arbeit", "Wäsche aus der Reinigung abholen #zuhause", "30 Minuten Dehnübungen #sport"],
               done=["Kunden-E-Mails beantworten #arbeit", "Morgenlauf #sport", "Pflanzen gießen #zuhause"], tomorrow=["Folien für die Demo am Montag vorbereiten #arbeit", "Wocheneinkauf erledigen #zuhause", "Zwei Kapitel „Deep Work“ lesen #lesen"],
               later=["Zahnarzttermin", "Autoversicherung verlängern #zuhause", "Teamausflug planen #arbeit", "1 km schwimmen #sport"], month=["Balkon neu streichen #zuhause", "Für einen Halbmarathon anmelden #sport"],
               inbox=["Vertrag an die Rechtsabteilung schicken #arbeit", "Termin für das Teamessen finden"], to_me="Checkliste für den Launch prüfen #arbeit", by_me="Raum für Freitag buchen #arbeit", tags=["arbeit", "zuhause", "sport", "lesen"]),
    "fr": dict(partner="Camille Dubois", me="Hugo Martin", frog="Terminer le rapport trimestriel #travail", today=["Point d'équipe du matin #travail", "Récupérer les vêtements au pressing #maison", "30 minutes d'étirements #sport"],
               done=["Répondre aux e-mails des clients #travail", "Course du matin #sport", "Arroser les plantes #maison"], tomorrow=["Préparer les slides de la démo de lundi #travail", "Faire les courses de la semaine #maison", "Lire deux chapitres de « Deep Work » #lecture"],
               later=["Rendez-vous chez le dentiste", "Renouveler l'assurance auto #maison", "Organiser le séminaire d'équipe #travail", "Nager 1 km #sport"], month=["Repeindre le balcon #maison", "S'inscrire à un semi-marathon #sport"],
               inbox=["Envoyer le contrat au service juridique #travail", "Choisir une date pour le dîner d'équipe"], to_me="Relire la checklist du lancement #travail", by_me="Réserver la salle pour vendredi #travail", tags=["travail", "maison", "sport", "lecture"]),
    "nl": dict(partner="Sanne de Vries", me="Daan Jansen", frog="Het kwartaalrapport afmaken #werk", today=["Teamoverleg #werk", "Kleren ophalen bij de stomerij #thuis", "30 minuten stretchen #sport"],
               done=["Klantmails beantwoorden #werk", "Ochtendrondje hardlopen #sport", "De planten water geven #thuis"], tomorrow=["Slides maken voor de demo van maandag #werk", "Boodschappen voor de week doen #thuis", "Twee hoofdstukken van ‘Deep Work’ lezen #lezen"],
               later=["Afspraak bij de tandarts", "Autoverzekering verlengen #thuis", "Het teamuitje plannen #werk", "1 km zwemmen #sport"], month=["Het balkon opnieuw schilderen #thuis", "Inschrijven voor een halve marathon #sport"],
               inbox=["Het contract naar juridische zaken sturen #werk", "Een datum kiezen voor het teamdiner"], to_me="De checklist voor de lancering nakijken #werk", by_me="De zaal voor vrijdag reserveren #werk", tags=["werk", "thuis", "sport", "lezen"]),
    "pl": dict(partner="Anna Kowalska", me="Piotr Nowak", frog="Dokończyć raport kwartalny #praca", today=["Poranne spotkanie zespołu #praca", "Odebrać ubrania z pralni #dom", "30 minut rozciągania #sport"],
               done=["Odpisać na maile od klientów #praca", "Poranny bieg #sport", "Podlać kwiaty #dom"], tomorrow=["Przygotować slajdy na poniedziałkowe demo #praca", "Zrobić zakupy na cały tydzień #dom", "Przeczytać dwa rozdziały „Deep Work” #czytanie"],
               later=["Wizyta u dentysty", "Odnowić ubezpieczenie auta #dom", "Zaplanować wyjazd integracyjny #praca", "Przepłynąć 1 km #sport"], month=["Pomalować balkon #dom", "Zapisać się na półmaraton #sport"],
               inbox=["Wysłać umowę do działu prawnego #praca", "Wybrać termin kolacji zespołu"], to_me="Sprawdzić checklistę przed premierą #praca", by_me="Zarezerwować salę na piątek #praca", tags=["praca", "dom", "sport", "czytanie"]),
    "tr": dict(partner="Elif Yılmaz", me="Can Demir", frog="Çeyrek raporunu bitir #ofis", today=["Ekiple sabah toplantısı #ofis", "Kuru temizlemeden kıyafetleri al #ev", "30 dakika esneme #spor"],
               done=["Müşteri e-postalarını yanıtla #ofis", "Sabah koşusu #spor", "Çiçekleri sula #ev"], tomorrow=["Pazartesi demosu için slaytları hazırla #ofis", "Haftalık market alışverişini yap #ev", "“Deep Work” kitabından iki bölüm oku #kitap"],
               later=["Diş hekimi randevusu", "Araba sigortasını yenile #ev", "Ekip gezisini planla #ofis", "1 km yüz #spor"], month=["Balkonu boya #ev", "Yarı maratona kaydol #spor"],
               inbox=["Sözleşmeyi hukuk ekibine gönder #ofis", "Ekip yemeği için tarih seç"], to_me="Lansman kontrol listesini gözden geçir #ofis", by_me="Cuma için toplantı salonunu ayırt #ofis", tags=["ofis", "ev", "spor", "kitap"]),
    "sv": dict(partner="Elin Johansson", me="Erik Andersson", frog="Göra klart kvartalsrapporten #jobb", today=["Morgonmöte med teamet #jobb", "Hämta kläderna på kemtvätten #hem", "30 minuters stretching #motion"],
               done=["Svara på kundmejl #jobb", "Morgonlöpning #motion", "Vattna blommorna #hem"], tomorrow=["Förbereda bilderna till måndagens demo #jobb", "Handla mat för veckan #hem", "Läsa två kapitel i ”Deep Work” #bok"],
               later=["Tandläkartid", "Förnya bilförsäkringen #hem", "Planera teamets kickoff #jobb", "Simma 1 km #motion"], month=["Måla om balkongen #hem", "Anmäla mig till ett halvmaraton #motion"],
               inbox=["Skicka avtalet till juristerna #jobb", "Välja datum för teammiddagen"], to_me="Gå igenom checklistan inför lanseringen #jobb", by_me="Boka lokalen till fredag #jobb", tags=["jobb", "hem", "motion", "bok"]),
    "id": dict(partner="Putri Lestari", me="Budi Santoso", frog="Selesaikan laporan kuartalan #kerja", today=["Rapat pagi dengan tim #kerja", "Ambil pakaian di laundry #rumah", "Peregangan 30 menit #olahraga"],
               done=["Balas email klien #kerja", "Lari pagi #olahraga", "Siram tanaman #rumah"], tomorrow=["Siapkan slide untuk demo hari Senin #kerja", "Belanja kebutuhan seminggu #rumah", "Baca dua bab “Deep Work” #baca"],
               later=["Janji temu dengan dokter gigi", "Perpanjang asuransi mobil #rumah", "Rencanakan outing tim #kerja", "Berenang 1 km #olahraga"], month=["Cat ulang balkon #rumah", "Daftar lomba half marathon #olahraga"],
               inbox=["Kirim kontrak ke tim legal #kerja", "Tentukan tanggal makan malam tim"], to_me="Periksa daftar cek peluncuran #kerja", by_me="Pesan ruangan untuk hari Jumat #kerja", tags=["kerja", "rumah", "olahraga", "baca"]),
    "vi": dict(partner="Nguyễn Thu Hà", me="Trần Minh Anh", frog="Hoàn thành báo cáo quý #congviec", today=["Họp giao ban với nhóm #congviec", "Lấy quần áo ở tiệm giặt là #nha", "Giãn cơ 30 phút #thethao"],
               done=["Trả lời email khách hàng #congviec", "Chạy bộ buổi sáng #thethao", "Tưới cây #nha"], tomorrow=["Chuẩn bị slide cho buổi demo thứ Hai #congviec", "Đi chợ cho cả tuần #nha", "Đọc hai chương “Deep Work” #docsach"],
               later=["Lịch hẹn nha sĩ", "Gia hạn bảo hiểm ô tô #nha", "Lên kế hoạch dã ngoại cho nhóm #congviec", "Bơi 1 km #thethao"], month=["Sơn lại ban công #nha", "Đăng ký chạy bán marathon #thethao"],
               inbox=["Gửi hợp đồng cho bộ phận pháp lý #congviec", "Chọn ngày ăn tối cùng nhóm"], to_me="Rà soát checklist ra mắt #congviec", by_me="Đặt phòng họp cho thứ Sáu #congviec", tags=["congviec", "nha", "thethao", "docsach"]),
    "ja": dict(partner="佐藤 美咲", me="田中 健", frog="四半期レポートを仕上げる #work", today=["チームの朝会 #work", "クリーニングを受け取る #home", "ストレッチ30分 #fitness"],
               done=["顧客へのメールに返信 #work", "朝のランニング #fitness", "植物に水やり #home"], tomorrow=["月曜のデモ用スライドを準備 #work", "1週間分の食料品を買う #home", "『Deep Work』を2章読む #reading"],
               later=["歯医者の予約", "車の保険を更新 #home", "チームのオフサイトを企画 #work", "1km泳ぐ #fitness"], month=["ベランダを塗り直す #home", "ハーフマラソンに申し込む #fitness"],
               inbox=["契約書を法務に送る #work", "チームの食事会の日程を決める"], to_me="ローンチのチェックリストを確認 #work", by_me="金曜日の会議室を予約 #work", tags=["work", "home", "fitness", "reading"]),
    "ko": dict(partner="김지은", me="이준호", frog="분기 보고서 마무리하기 #work", today=["팀 아침 회의 #work", "세탁소에서 옷 찾아오기 #home", "스트레칭 30분 #fitness"],
               done=["고객 이메일 답장하기 #work", "아침 달리기 #fitness", "화분에 물 주기 #home"], tomorrow=["월요일 데모 슬라이드 준비하기 #work", "일주일 치 장보기 #home", "『Deep Work』 두 챕터 읽기 #reading"],
               later=["치과 예약", "자동차 보험 갱신하기 #home", "팀 워크숍 계획하기 #work", "수영 1km #fitness"], month=["발코니 다시 칠하기 #home", "하프 마라톤 신청하기 #fitness"],
               inbox=["계약서를 법무팀에 보내기 #work", "팀 회식 날짜 정하기"], to_me="출시 체크리스트 검토하기 #work", by_me="금요일 회의실 예약하기 #work", tags=["work", "home", "fitness", "reading"]),
    "zh-hans": dict(partner="王小雨", me="李明", frog="完成季度报告 #work", today=["团队晨会 #work", "去干洗店取衣服 #home", "拉伸 30 分钟 #fitness"],
                    done=["回复客户邮件 #work", "晨跑 #fitness", "给植物浇水 #home"], tomorrow=["准备周一演示的幻灯片 #work", "采购一周的食材 #home", "读两章《深度工作》 #reading"],
                    later=["看牙医", "续保车险 #home", "策划团队团建 #work", "游泳 1 公里 #fitness"], month=["重新粉刷阳台 #home", "报名半程马拉松 #fitness"],
                    inbox=["把合同发给法务 #work", "定一下团队聚餐的日期"], to_me="检查发布清单 #work", by_me="预订周五的会议室 #work", tags=["work", "home", "fitness", "reading"]),
    "zh-hant": dict(partner="陳怡君", me="林志明", frog="完成季度報告 #work", today=["團隊晨會 #work", "去乾洗店拿衣服 #home", "伸展 30 分鐘 #fitness"],
                    done=["回覆客戶郵件 #work", "晨跑 #fitness", "幫植物澆水 #home"], tomorrow=["準備週一展示的投影片 #work", "採買一週的食材 #home", "讀兩章《深度工作力》 #reading"],
                    later=["看牙醫", "續保汽車保險 #home", "規劃團隊外出活動 #work", "游泳 1 公里 #fitness"], month=["重新粉刷陽台 #home", "報名半程馬拉松 #fitness"],
                    inbox=["把合約寄給法務 #work", "決定團隊聚餐的日期"], to_me="檢查上線清單 #work", by_me="預訂週五的會議室 #work", tags=["work", "home", "fitness", "reading"]),
    "ar": dict(partner="سارة أحمد", me="عمر خالد", frog="إنهاء التقرير ربع السنوي #work", today=["اجتماع الفريق الصباحي #work", "استلام الملابس من المغسلة #home", "تمارين إطالة لمدة 30 دقيقة #fitness"],
               done=["الرد على رسائل العملاء #work", "الجري الصباحي #fitness", "سقي النباتات #home"], tomorrow=["تحضير شرائح عرض يوم الاثنين #work", "شراء مستلزمات الأسبوع #home", "قراءة فصلين من كتاب «العمل العميق» #reading"],
               later=["موعد عند طبيب الأسنان", "تجديد تأمين السيارة #home", "التخطيط لرحلة الفريق #work", "السباحة لمسافة 1 كم #fitness"], month=["إعادة طلاء الشرفة #home", "التسجيل في نصف ماراثون #fitness"],
               inbox=["إرسال العقد إلى الفريق القانوني #work", "اختيار موعد لعشاء الفريق"], to_me="مراجعة قائمة مهام الإطلاق #work", by_me="حجز القاعة ليوم الجمعة #work", tags=["work", "home", "fitness", "reading"]),
    "hi": dict(partner="प्रिया शर्मा", me="राहुल वर्मा", frog="तिमाही रिपोर्ट पूरी करना #work", today=["टीम की सुबह की मीटिंग #work", "ड्राई क्लीनर से कपड़े लाना #home", "30 मिनट स्ट्रेचिंग #fitness"],
               done=["क्लाइंट के ईमेल का जवाब देना #work", "सुबह की दौड़ #fitness", "पौधों को पानी देना #home"], tomorrow=["सोमवार के डेमो की स्लाइड तैयार करना #work", "हफ़्ते भर का राशन खरीदना #home", "“Deep Work” के दो अध्याय पढ़ना #reading"],
               later=["दाँतों के डॉक्टर से अपॉइंटमेंट", "कार का बीमा रिन्यू करना #home", "टीम आउटिंग की योजना बनाना #work", "1 किमी तैरना #fitness"], month=["बालकनी को फिर से पेंट करना #home", "हाफ़ मैराथन के लिए रजिस्टर करना #fitness"],
               inbox=["कॉन्ट्रैक्ट लीगल टीम को भेजना #work", "टीम डिनर की तारीख तय करना"], to_me="लॉन्च की चेकलिस्ट देखना #work", by_me="शुक्रवार के लिए हॉल बुक करना #work", tags=["work", "home", "fitness", "reading"]),
    "th": dict(partner="ปิยะนุช ศรีสุข", me="ธนากร วงศ์ใหญ่", frog="ทำรายงานรายไตรมาสให้เสร็จ #work", today=["ประชุมทีมตอนเช้า #work", "ไปรับผ้าที่ร้านซักแห้ง #home", "ยืดเหยียด 30 นาที #fitness"],
               done=["ตอบอีเมลลูกค้า #work", "วิ่งตอนเช้า #fitness", "รดน้ำต้นไม้ #home"], tomorrow=["เตรียมสไลด์สำหรับเดโมวันจันทร์ #work", "ซื้อของเข้าบ้านสำหรับทั้งสัปดาห์ #home", "อ่าน “Deep Work” สองบท #reading"],
               later=["นัดหมอฟัน", "ต่อประกันรถยนต์ #home", "วางแผนกิจกรรมนอกสถานที่ของทีม #work", "ว่ายน้ำ 1 กม. #fitness"], month=["ทาสีระเบียงใหม่ #home", "สมัครวิ่งฮาล์ฟมาราธอน #fitness"],
               inbox=["ส่งสัญญาให้ฝ่ายกฎหมาย #work", "เลือกวันกินข้าวเย็นกับทีม"], to_me="ตรวจเช็กลิสต์ก่อนเปิดตัว #work", by_me="จองห้องประชุมสำหรับวันศุกร์ #work", tags=["work", "home", "fitness", "reading"]),
}[lang]

T["add"] = ADD[lang]
if sys.argv[3:] == ["--frog"]:
    sys.exit(print(T["frog"]))
if sys.argv[3:] == ["--add"]:
    sys.exit(print(T["add"]))
if sys.argv[3:] == ["--texts"]:
    sys.exit(print(json.dumps(T, ensure_ascii=False)))


def call(method, path, body=None, token=None):
    req = urllib.request.Request(api + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("token", token)
    # straight to the local backend, past any HTTP(S)_PROXY in the environment
    return json.load(urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req))


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
sync(tp, [{"c": "todo", "id": oid(), "at": now, "set": {"text": text, "order": i, "user": me["_id"], "delegator": partner["_id"], **day(today + timedelta(days=1 + i))}}
          for i, text in enumerate([T["to_me"]] + T["inbox"])])
print(tm)
