package app.pocketmanager.personal;

import android.Manifest;
import android.content.Intent;
import android.database.Cursor;
import android.provider.Settings;
import android.provider.Telephony;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** 웹 화면(app.js)에서 부르는 결제 문자·알림 읽기 기능 */
@CapacitorPlugin(
        name = "PaymentReader",
        permissions = {
                @Permission(alias = "sms", strings = {Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS})
        })
public class PaymentReaderPlugin extends Plugin {

    @Override
    public void load() {
        // 앱이 열려 있는 동안 새 결제가 오면 화면에 바로 알립니다.
        PaymentInbox.setListener(item -> {
            try {
                notifyListeners("payment", new JSObject(item.toString()));
            } catch (JSONException ignored) {
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        PaymentInbox.setListener(null);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("sms", getPermissionState("sms") == PermissionState.GRANTED);
        ret.put("notifications", NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName()));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestSms(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            status(call);
        } else {
            requestPermissionForAlias("sms", call, "smsPermissionCallback");
        }
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        status(call);
    }

    /** 휴대폰 설정의 '알림 접근 허용' 화면을 엽니다. 사용자가 직접 켜야 합니다. */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** 앱이 꺼져 있는 동안 모인 결제 문자·알림을 꺼냅니다. */
    @PluginMethod
    public void drain(PluginCall call) {
        JSONArray arr = PaymentInbox.drain(getContext());
        try {
            JSObject ret = new JSObject();
            ret.put("items", new JSArray(arr.toString()));
            call.resolve(ret);
        } catch (JSONException e) {
            call.reject("보관함을 읽지 못했어요");
        }
    }

    /** 확인용: 최근 받은 결제·입출금 알림과 처리 결과 */
    @PluginMethod
    public void recent(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("items", new JSArray(PaymentInbox.recent(getContext()).toString()));
            call.resolve(ret);
        } catch (JSONException e) {
            call.reject("기록을 읽지 못했어요");
        }
    }

    @PluginMethod
    public void clearRecent(PluginCall call) {
        PaymentInbox.clearRecent(getContext());
        call.resolve();
    }

    /** 문자함에서 최근 N일의 결제 문자를 읽어 옵니다(처음 설치했을 때 과거 내역 가져오기). */
    @PluginMethod
    public void readInbox(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("문자 읽기 권한이 없어요");
            return;
        }
        int days = Math.max(1, Math.min(call.getInt("days", 90), 400));
        long since = System.currentTimeMillis() - days * 86_400_000L;
        JSArray items = new JSArray();
        String[] cols = {Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.ADDRESS};
        try (Cursor c = getContext().getContentResolver().query(
                Telephony.Sms.Inbox.CONTENT_URI, cols, Telephony.Sms.DATE + " > ?",
                new String[]{String.valueOf(since)}, Telephony.Sms.DATE + " DESC")) {
            int count = 0;
            while (c != null && c.moveToNext() && count < 2000) {
                String body = c.getString(0);
                if (!PaymentInbox.looksLikePayment(body)) continue;
                JSONObject o = new JSONObject();
                o.put("id", Integer.toHexString((body + "|" + (c.getLong(1) / 60000)).hashCode()));
                o.put("text", body);
                o.put("time", c.getLong(1));
                o.put("source", "sms");
                o.put("from", c.getString(2));
                items.put(o);
                count++;
            }
        } catch (Exception e) {
            call.reject("문자함을 읽지 못했어요: " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("items", items);
        call.resolve(ret);
    }
}
