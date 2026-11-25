package app.pocketmanager.personal;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PaymentReaderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
