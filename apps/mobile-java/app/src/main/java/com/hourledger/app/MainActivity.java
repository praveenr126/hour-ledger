package com.hourledger.app;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import com.google.gson.JsonObject;
import com.hourledger.app.network.ApiClient;
import com.hourledger.app.network.HourLedgerApi;
import com.hourledger.app.network.SessionManager;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class MainActivity extends AppCompatActivity {

    private EditText etPhone, etOtp;
    private TextView tvDevOtp, tvStatus;
    private HourLedgerApi api;
    private SessionManager session;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        etPhone = findViewById(R.id.etPhone);
        etOtp = findViewById(R.id.etOtp);
        tvDevOtp = findViewById(R.id.tvDevOtp);
        tvStatus = findViewById(R.id.tvStatus);
        Button btnSendOtp = findViewById(R.id.btnSendOtp);
        Button btnVerifyOtp = findViewById(R.id.btnVerifyOtp);

        session = new SessionManager(this);
        api = ApiClient.getInstance(this).create(HourLedgerApi.class);

        if (session.isLoggedIn()) {
            tvStatus.setText("Restoring session...");
            fetchCurrentUser();
        }

        btnSendOtp.setOnClickListener(v -> sendOtp());
        btnVerifyOtp.setOnClickListener(v -> verifyOtp());
    }

    private void sendOtp() {
        String phone = etPhone.getText().toString().trim();
        tvStatus.setText("Contacting Render server (may take ~45s if waking up)...");

        JsonObject body = new JsonObject();
        body.addProperty("phone", phone);

        api.requestOtp(body).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject res = response.body();
                    String code = res.has("dev_otp") ? res.get("dev_otp").getAsString()
                            : (res.has("otp") ? res.get("otp").getAsString() : "");
                    if (!code.isEmpty()) {
                        tvDevOtp.setVisibility(View.VISIBLE);
                        tvDevOtp.setText("Dev OTP: " + code);
                        etOtp.setText(code);
                    }
                    tvStatus.setText("OTP sent to " + phone);
                } else {
                    tvStatus.setText("OTP request failed (" + response.code() + "): " + readError(response));
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                tvStatus.setText("Network error: " + t.getMessage());
            }
        });
    }

    private void verifyOtp() {
        String phone = etPhone.getText().toString().trim();
        String code = etOtp.getText().toString().trim();
        tvStatus.setText("Verifying OTP...");

        JsonObject body = new JsonObject();
        body.addProperty("phone", phone);
        body.addProperty("code", code);

        api.verifyOtp(body).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject res = response.body();
                    String token = res.has("access_token") ? res.get("access_token").getAsString()
                            : (res.has("token") ? res.get("token").getAsString() : null);
                    if (token != null) {
                        session.saveToken(token);
                        tvStatus.setText("Signed in! Opening dashboard...");
                        fetchCurrentUser();
                    } else {
                        tvStatus.setText("Unexpected response: " + res);
                    }
                } else {
                    tvStatus.setText("Verification failed (" + response.code() + "): " + readError(response));
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                tvStatus.setText("Network error: " + t.getMessage());
            }
        });
    }

    private void fetchCurrentUser() {
        api.getMe().enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null) {
                    startActivity(new Intent(MainActivity.this, HomeActivity.class));
                    finish();
                } else {
                    session.clear();
                    tvStatus.setText("Session expired. Please sign in again.");
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                tvStatus.setText("Failed to load profile: " + t.getMessage());
            }
        });
    }

    private String readError(Response<?> response) {
        try {
            if (response.errorBody() != null) {
                return response.errorBody().string();
            }
        } catch (Exception ignored) {
        }
        return "";
    }
}
