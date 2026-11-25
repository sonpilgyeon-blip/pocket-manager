package app.pocketmanager.personal;

import android.app.Notification;
import android.os.Build;
import android.os.Bundle;
import android.provider.Telephony;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.regex.Pattern;

/**
 * 은행 앱(입출금)·카드사 앱·토스·카카오페이 등의 푸시 알림을 읽습니다.
 * 사용자가 휴대폰 설정에서 '알림 접근'을 직접 허용해야 동작합니다.
 * 결제·입출금처럼 보이는 알림만 보관하고, 나머지(대화, 광고 등)는 읽고 바로 버립니다.
 */
public class PaymentNotificationListener extends NotificationListenerService {
    // 개인 대화가 섞이지 않도록 카드·간편결제·은행 입출금 알림만 받습니다.
    private static final Pattern PAY_SOURCE = Pattern.compile(
            "카드|체크|페이|pay|Pay|PAY|토스|뱅크|은행|승인|결제|입금|출금|이체|송금|잔액");

    // 은행·카드·간편결제 앱 (확인용 기록에 남길 앱)
    private static final Pattern FINANCE_PKG = Pattern.compile(
            "kbstar|kbcard|kbank|shinhan|woori|hana|nonghyup|\\.nh\\.|ibk|kakaobank|viva\\.republica|toss|samsungcard|hyundaicard|lottecard|bccard|citi|kakaopay|naverpay|payco|epost|kfcc|suhyup|busanbank|dgb|kjbank|jbbank|scbank",
            Pattern.CASE_INSENSITIVE);

    // 카카오톡 알림톡: 보낸 곳(알림 제목)이 은행·카드사 채널일 때만 읽습니다. 사람과의 대화는 읽지 않습니다.
    private static final Pattern FINANCE_SENDER = Pattern.compile(
            "은행|뱅크|카드|페이|증권|저축|금고|신협|우체국|토스|KB|국민|신한|우리|하나|농협|NH|IBK|기업|케이뱅크|새마을");

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String pkg = sbn.getPackageName();
        if (pkg == null || pkg.equals(getPackageName())) return;
        // 문자 앱 알림은 SmsReceiver가 이미 처리하므로 건너뜁니다(중복 방지).
        String smsApp = Telephony.Sms.getDefaultSmsPackage(this);
        if (pkg.equals(smsApp)) return;

        Notification n = sbn.getNotification();
        if (n == null) return;
        // 같은 앱 알림을 묶는 요약 알림은 내용이 없거나 겹치므로 건너뜁니다.
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        Bundle ex = n.extras;
        CharSequence title = ex.getCharSequence(Notification.EXTRA_TITLE);
        String titleStr = title != null ? title.toString() : "";

        boolean kakao = pkg.startsWith("com.kakao.talk");
        if (kakao) {
            boolean group = Build.VERSION.SDK_INT >= 28 && ex.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION, false);
            if (group || !FINANCE_SENDER.matcher(titleStr).find()) return; // 개인·단체 대화는 읽지 않고 기록도 남기지 않습니다
        }

        String body = (titleStr.isEmpty() ? "" : titleStr + "\n") + readText(ex);
        body = body.trim();
        boolean finance = kakao || FINANCE_PKG.matcher(pkg).find();

        if (!PAY_SOURCE.matcher(body).find()) {
            if (finance) PaymentInbox.logRecent(this, body, pkg, "결제·입출금 단어가 없어 건너뜀");
            return;
        }
        if (!PaymentInbox.looksLikePayment(body)) {
            if (finance) PaymentInbox.logRecent(this, body, pkg, "금액을 찾지 못해 건너뜀");
            return;
        }
        PaymentInbox.add(this, body, sbn.getPostTime(), "notification", pkg);
    }

    // 긴 글(BigText), 여러 줄(Inbox 스타일), 일반 글 순서로 알림 본문을 읽습니다.
    private static String readText(Bundle ex) {
        CharSequence big = ex.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (big != null && big.length() > 0) return big.toString();
        CharSequence[] lines = ex.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (lines != null && lines.length > 0) {
            StringBuilder sb = new StringBuilder();
            for (CharSequence l : lines) if (l != null) sb.append(l).append('\n');
            return sb.toString();
        }
        CharSequence text = ex.getCharSequence(Notification.EXTRA_TEXT);
        CharSequence sub = ex.getCharSequence(Notification.EXTRA_SUB_TEXT);
        return (text != null ? text : "") + (sub != null ? "\n" + sub : "");
    }
}
