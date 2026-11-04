# HearMe Dashboard — Wi-Fi + USB + SQLite

## 1) تشغيل المشروع
ثبت Node.js 20 أو أحدث، ثم افتح Terminal داخل مجلد المشروع:

```bash
npm install
npm start
```

افتح `http://localhost:3000` من Chrome أو Edge. قاعدة البيانات ستُنشأ تلقائياً في `data/hearme.sqlite`.

## 2) طريقة الاتصال
- **USB Debug:** زر Connect Device الأصلي عبر Web Serial (Chrome/Edge).
- **Wi-Fi Live:** شغّل السيرفر على الكمبيوتر، واجعل ESP32-S3 يتصل بنفس شبكة Wi-Fi ثم يفتح WebSocket Client إلى `ws://COMPUTER_LAN_IP:3000/device`. الـ Dashboard يتصل تلقائياً بالسيرفر عبر `/dashboard`، ويعرض حالة الجهاز ويبعث أوامر الاهتزاز من خلال السيرفر.
- افتح منفذ TCP رقم 3000 في Firewall للاتصال المحلي. لا تستخدم هذا الإعداد على شبكة عامة دون حماية.

> ملحوظة: كود ESP32 الحالي التشخيصي لا ينفذ WebSocket أو TinyML بعد. يلزم تعديل Firmware ليصبح WebSocket Client ويرسل الرسائل التالية. هذا المشروع يجهز الـ Dashboard والـ Backend وقاعدة البيانات، ولا يدّعي أن السوار أصبح متصلاً قبل إضافة ذلك إلى Firmware.

## 3) بروتوكول ESP32-S3
كل رسالة WebSocket تكون JSON object واحدة:

Device → Server:
```json
{"type":"telemetry","device":"ESP32-S3","firmware":"1.0.0","uptime_ms":120000,"battery_voltage":4.1,"battery_percent":90,"free_psram":7000000,"total_psram":8388608,"rms":0.04,"peak":0.2,"latency_ms":112,"wifi_connected":true,"wifi_ip":"192.168.1.80","wifi_rssi":-54}
{"type":"inference","total_inferences":1250,"inference_ms":112,"predicted_class":"doorbell","confidence":0.91}
{"type":"detection","event":"doorbell","confidence":0.91,"latency_ms":112,"haptic_pattern":"doorbell"}
{"type":"ack","command":"test_doorbell","status":"success"}
```

Server → Device:
```json
{"type":"command","command":"test_doorbell"}
```

الفئات المدعومة: `knocking`, `doorbell`, `name_call`, `fire_alarm`, `unknown`.
أوامر الاهتزاز: `test_knocking`, `test_doorbell`, `test_name_call`, `test_fire_alarm`.

`inference` تسجل كل نافذة تحليل أو ترسل عداد `total_inferences` التراكمي. `detection` تُرسل فقط عند تحقق تصنيف مؤكد. لا ترسل Detection لكل نافذة تحليل.

## 4) ما يتم حفظه في SQLite
- `telemetry`: قراءات البطارية والذاكرة والصوت والـ latency والـ Wi-Fi (عينة كل ثانية من الواجهة).
- `detections`: التنبيهات المؤكدة مع الثقة والوقت والـ haptic والـ latency.
- `inferences`: عدد نوافذ التحليل وزمن الاستدلال والفئة والثقة.
- `commands`: أوامر الاختبار وردود ACK.
- `experiments`: تجارب محفوظة يدوياً من زر Save Experiment، مع ملاحظات وملخص إعدادات/حالة التجربة.
- `settings`: جدول جاهز لحفظ إعدادات الجهاز والواجهة لاحقاً.

## 5) ملاحظات هندسية
- المعالجة الصوتية وTinyML تظل محلية على ESP32؛ لا يتم إرسال الصوت الخام للسيرفر افتراضياً حفاظاً على الخصوصية وتقليل استهلاك الشبكة.
- لا تعتبر قيمة Battery Percent صحيحة إلا بعد معايرة ADC ومعرفة نوع البطارية.
- SQLite مناسبة لتجارب فريق على جهاز/سيرفر واحد. لو هتستخدموا عدة أجهزة أو مستخدمين متزامنين على نطاق واسع، فكروا لاحقاً في PostgreSQL.
