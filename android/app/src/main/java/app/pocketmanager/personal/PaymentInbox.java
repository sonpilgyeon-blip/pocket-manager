package app.pocketmanager.personal;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.regex.Pattern;

/**
 * 결제로 보이는 문자·알림을 앱이 열릴 때까지 휴대폰 안에 잠시 보관하는 상자.
 * 결제와 무관한 문자·알림은 여기 들어오지 않고 바로 버려집니다.
 */
public final class PaymentInbox {
    private static final String PREFS = "payment_inbox";
    private static final String KEY = "items";
    private static final int MAX_ITEMS = 500;

    // 금액(…원) + 결제·입출금 단어가 함께 있어야 보관합니다.
    // 은행 입출금 알림은 "12,000"처럼 '원' 없이 오기도 해서, 입출금 단어가 있으면 쉼표 숫자도 금액으로 봅니다.
    private static final Pattern AMOUNT = Pattern.compile("[\\d,]{1,12}\\s*원");
    private static final Pattern BARE_AMOUNT = Pattern.compile("\\d{1,3}(,\\d{3})+");
    private static final Pattern PAYMENT_WORD = Pattern.compile(
            "승인|결제|취소|사용|일시불|할부|출금|입금|이체|송금|보냈|받았|잔액|체크|카드|페이|누적");
    private static final Pattern BANK_WORD = Pattern.compile("입금|출금|이체|송금|잔액");
    // 해외 결제: "USD 9.99", "$9.99", "9.99달러", "JPY 1,200"
    private static final Pattern FOREIGN = Pattern.compile(
            "(USD|EUR|GBP|JPY|CNY|HKD|SGD|AUD|CAD|US\\$|\\$)\\s?[\\d,]+(\\.\\d{1,2})?"
            + "|[\\d,]+(\\.\\d{1,2})?\\s?(USD|EUR|GBP|JPY|CNY|달러|유로|엔|위안|파운드)");

    /** 앱이 열려 있을 때 바로 알려 줄 대상 (없으면 상자에만 보관) */
    public interface Listener { void onPayment(JSONObject item); }
    private static volatile Listener listener;
    public static void setListener(Listener l) { listener = l; }

    private PaymentInbox() {}

    public static boolean looksLikePayment(String text) {
        if (text == null || text.length() < 6 || text.length() > 1000) return false;
        if (AMOUNT.matcher(text).find() && PAYMENT_WORD.matcher(text).find()) return true;
        if (FOREIGN.matcher(text).find() && PAYMENT_WORD.matcher(text).find()) return true;
        return BANK_WORD.matcher(text).find() && BARE_AMOUNT.matcher(text).find();
    }

    // ---------- 확인용 기록: 최근 받은 결제·입출금 알림 20건 (이 휴대폰 안에만, 앱 설정에서 볼 수 있음) ----------
    private static final String RECENT = "recent";
    private static final int MAX_RECENT = 20;

    public static synchronized void logRecent(Context ctx, String text, String from, String result) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray(sp.getString(RECENT, "[]"));
            JSONObject o = new JSONObject();
            o.put("text", text.length() > 300 ? text.substring(0, 300) : text);
            o.put("from", from == null ? "" : from);
            o.put("time", System.currentTimeMillis());
            o.put("result", result);
            arr.put(o);
            while (arr.length() > MAX_RECENT) arr.remove(0);
            sp.edit().putString(RECENT, arr.toString()).apply();
        } catch (JSONException ignored) {
        }
    }

    public static synchronized JSONArray recent(Context ctx) {
        try {
            return new JSONArray(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(RECENT, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    public static synchronized void clearRecent(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(RECENT).apply();
    }

    public static synchronized void add(Context ctx, String text, long time, String source, String from) {
        if (!looksLikePayment(text)) return;
        logRecent(ctx, text, from, "앱으로 보냄");
        try {
            JSONObject item = new JSONObject();
            item.put("id", Integer.toHexString((text + "|" + (time / 60000)).hashCode()));
            item.put("text", text);
            item.put("time", time);
            item.put("source", source);
            item.put("from", from == null ? "" : from);

            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray(sp.getString(KEY, "[]"));
            for (int i = 0; i < arr.length(); i++) {
                if (item.getString("id").equals(arr.getJSONObject(i).optString("id"))) return; // 같은 내용 중복
            }
            arr.put(item);
            while (arr.length() > MAX_ITEMS) arr.remove(0);
            sp.edit().putString(KEY, arr.toString()).apply();

            Listener l = listener;
            if (l != null) l.onPayment(item);
        } catch (JSONException ignored) {
        }
    }

    /** 보관된 항목을 모두 꺼내고 상자를 비웁니다. */
    public static synchronized JSONArray drain(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray arr;
        try {
            arr = new JSONArray(sp.getString(KEY, "[]"));
        } catch (JSONException e) {
            arr = new JSONArray();
        }
        sp.edit().remove(KEY).apply();
        return arr;
    }
}
