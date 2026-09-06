# FitHouse — Local Reader Agent

პატარა ლოკალური სერვისი, რომელიც ბრაუზერს PC/SC წამკითხველ(ებ)თან აკავშირებს
`127.0.0.1`-ზე. FitHouse-ის smart-card ფუნქცია ამ აგენტს ელაპარაკება.

```
Browser (smartcard.js)  →  agent (127.0.0.1:47800)  →  PC/SC  →  reader(s)
```

## გაშვება (macOS)

```bash
cd reader-agent
npm install            # პირველ ჯერზე (ჩამოტვირთავს pcsclite-ს)
npm start              # რეალური წამკითხველი(ები)
```

წამკითხველის გარეშე ტესტისთვის:

```bash
npm run mock           # /read აბრუნებს ყალბ, სტაბილურ UID-ს
```

## წამკითხველების მხარდაჭერა

მუშაობს ნებისმიერ PC/SC წამკითხველთან და **რამდენიმესთან ერთდროულადაც**:

- **კონტაქტური** (SCR3310 / Identive SCR33xx) — ჩიპიანი ბარათი სლოტში.
  იდენტიფიკატორი: ბარათის CPLC ჩიპის სერიული (`GET DATA 9F 7F`).
- **Contactless / RFID** (ACR122U, uTrust/Identive 3700F, NFC) — ბარათის
  მიახლოება. იდენტიფიკატორი: ბარათის UID (`FF CA 00 00 00`).

წაკითხვას ემსახურება ის წამკითხველი, რომელზეც ბარათია — ანუ კონტაქტური და
RFID წამკითხველი ერთდროულად შეიძლება ჩართული იყოს.

> RFID/contactless ბარათს **RFID წამკითხველი სჭირდება**. კონტაქტური SCR3310
> RFID ბარათს **ვერ** წაიკითხავს (მას ანტენა არ აქვს).

## Endpoints

- `GET /status` → `{ readerConnected, readerName, readerCount, mode }`
- `GET /read?timeout=ms` → `{ ok, type, uid }` ან `{ ok:false, error, code }`

CORS ჩაკეტილია FitHouse-ის origin-ებზე; ისმენს მხოლოდ `127.0.0.1`-ს.
