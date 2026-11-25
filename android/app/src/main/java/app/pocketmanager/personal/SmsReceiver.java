package app.pocketmanager.personal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.util.LinkedHashMap;
import java.util.Map;

/** 새 문자가 오면(앱이 꺼져 있어도) 결제 문자만 골라 PaymentInbox에 넣습니다. */
public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null) return;

        // 긴 문자는 여러 조각으로 오므로 보낸 번호별로 이어 붙입니다.
        Map<String, StringBuilder> bodies = new LinkedHashMap<>();
        long time = System.currentTimeMillis();
        for (SmsMessage m : parts) {
            if (m == null) continue;
            String from = m.getDisplayOriginatingAddress();
            StringBuilder sb = bodies.get(from);
            if (sb == null) { sb = new StringBuilder(); bodies.put(from, sb); }
            sb.append(m.getDisplayMessageBody());
            time = m.getTimestampMillis();
        }
        for (Map.Entry<String, StringBuilder> e : bodies.entrySet()) {
            PaymentInbox.add(context, e.getValue().toString(), time, "sms", e.getKey());
        }
    }
}
