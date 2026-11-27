package com.hourledger.app;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.zxing.BarcodeFormat;
import com.hourledger.app.network.ApiClient;
import com.hourledger.app.network.HourLedgerApi;
import com.hourledger.app.network.SessionManager;
import com.journeyapps.barcodescanner.BarcodeEncoder;
import java.util.Locale;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class HomeActivity extends AppCompatActivity {

    private TextView tvAccountSummary, tvFeedMessage;
    private EditText etTopUpRupees;
    private LinearLayout llJobsContainer;
    private HourLedgerApi api;
    private SessionManager session;
    private boolean showingMyJobs = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_home);

        session = new SessionManager(this);
        api = ApiClient.getInstance(this).create(HourLedgerApi.class);

        tvAccountSummary = findViewById(R.id.tvAccountSummary);
        tvFeedMessage = findViewById(R.id.tvFeedMessage);
        etTopUpRupees = findViewById(R.id.etTopUpRupees);
        llJobsContainer = findViewById(R.id.llJobsContainer);

        findViewById(R.id.btnLogout).setOnClickListener(v -> {
            session.clear();
            startActivity(new Intent(this, MainActivity.class));
            finish();
        });

        findViewById(R.id.btnTopUp).setOnClickListener(v -> topUpWallet());

        findViewById(R.id.btnCreateJob).setOnClickListener(v ->
                startActivity(new Intent(this, CreateJobActivity.class)));

        findViewById(R.id.btnOpenJobs).setOnClickListener(v -> {
            showingMyJobs = false;
            loadJobs();
        });

        findViewById(R.id.btnMyJobs).setOnClickListener(v -> {
            showingMyJobs = true;
            loadJobs();
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        loadAccount();
        loadJobs();
    }

    private void loadAccount() {
        api.getMe().enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject me = response.body();
                    String phone = getStr(me, "phone", "");
                    int trust = me.has("trust_score") ? me.get("trust_score").getAsInt() : 0;
                    long balancePaise = 0;
                    if (me.has("wallet") && me.get("wallet").isJsonObject()) {
                        JsonObject w = me.getAsJsonObject("wallet");
                        if (w.has("balance_paise")) {
                            balancePaise = w.get("balance_paise").getAsLong();
                        }
                    }
                    double rupees = balancePaise / 100.0;
                    tvAccountSummary.setText(String.format(
                            Locale.US,
                            "Phone: %s  |  Trust Score: %d\nWallet Balance: ₹%.2f",
                            phone, trust, rupees
                    ));
                } else {
                    tvAccountSummary.setText("Error loading account (" + response.code() + "): " + readError(response));
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                tvAccountSummary.setText("Error loading wallet: " + t.getMessage());
            }
        });
    }

    private void topUpWallet() {
        String raw = etTopUpRupees.getText().toString().trim();
        if (raw.isEmpty()) return;
        long paise = Long.parseLong(raw) * 100L;

        JsonObject body = new JsonObject();
        body.addProperty("amount_paise", paise);

        tvFeedMessage.setText("Processing top-up of ₹" + raw + "...");

        api.topUpWallet(body).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (response.isSuccessful()) {
                    tvFeedMessage.setText("Added ₹" + raw + " to wallet.");
                    Toast.makeText(HomeActivity.this, "Added ₹" + raw + " to wallet", Toast.LENGTH_SHORT).show();
                    loadAccount();
                } else {
                    String msg = "Top-up failed (" + response.code() + "): " + readError(response);
                    tvFeedMessage.setText(msg);
                    Toast.makeText(HomeActivity.this, msg, Toast.LENGTH_LONG).show();
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                tvFeedMessage.setText("Network error: " + t.getMessage());
                Toast.makeText(HomeActivity.this, "Network error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void loadJobs() {
        tvFeedMessage.setText(showingMyJobs ? "Loading My Jobs..." : "Loading Open Jobs...");
        llJobsContainer.removeAllViews();

        Call<JsonObject> call = showingMyJobs ? api.getMyJobs() : api.listJobs(null, null, null);
        call.enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (!response.isSuccessful() || response.body() == null) {
                    tvFeedMessage.setText("Failed to load jobs (" + response.code() + "): " + readError(response));
                    return;
                }
                JsonObject res = response.body();
                JsonArray arr = null;
                if (res.has("jobs") && res.get("jobs").isJsonArray()) {
                    arr = res.getAsJsonArray("jobs");
                } else if (res.has("items") && res.get("items").isJsonArray()) {
                    arr = res.getAsJsonArray("items");
                } else if (res.has("data") && res.get("data").isJsonArray()) {
                    arr = res.getAsJsonArray("data");
                }

                if (arr == null || arr.size() == 0) {
                    tvFeedMessage.setText(showingMyJobs ? "No jobs in your list yet." : "No open jobs right now.");
                    return;
                }

                tvFeedMessage.setText((showingMyJobs ? "My Jobs (" : "Open Jobs (") + arr.size() + ")");
                for (JsonElement el : arr) {
                    if (el.isJsonObject()) {
                        addJobCard(el.getAsJsonObject());
                    }
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                tvFeedMessage.setText("Network error: " + t.getMessage());
            }
        });
    }

    private void addJobCard(JsonObject job) {
        final String jobId = getStr(job, "id", "");
        String title = getStr(job, "title", "Untitled Shift");
        String status = getStr(job, "status", "open");
        final double lat = job.has("lat") && !job.get("lat").isJsonNull() ? job.get("lat").getAsDouble() : 12.9141;
        final double lng = job.has("lng") && !job.get("lng").isJsonNull() ? job.get("lng").getAsDouble() : 74.8560;

        long payPaise = 0;
        if (job.has("total_paise")) payPaise = job.get("total_paise").getAsLong();
        else if (job.has("pay_paise")) payPaise = job.get("pay_paise").getAsLong();
        else if (job.has("hourly_rate_paise")) payPaise = job.get("hourly_rate_paise").getAsLong();

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(Color.WHITE);
        card.setPadding(32, 28, 32, 28);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, 24);
        card.setLayoutParams(params);

        TextView tvTitle = new TextView(this);
        tvTitle.setText(title);
        tvTitle.setTextSize(17f);
        tvTitle.setTypeface(null, Typeface.BOLD);
        tvTitle.setTextColor(Color.parseColor("#18181B"));
        card.addView(tvTitle);

        TextView tvMeta = new TextView(this);
        tvMeta.setText(String.format(Locale.US, "Pay: ₹%.2f  •  Status: %s", payPaise / 100.0, status.toUpperCase(Locale.US)));
        tvMeta.setTextSize(13f);
        tvMeta.setTextColor(Color.parseColor("#52525B"));
        tvMeta.setPadding(0, 8, 0, 16);
        card.addView(tvMeta);

        if (!showingMyJobs) {
            Button btnApply = new Button(this);
            btnApply.setText("Apply for Job");
            btnApply.setOnClickListener(v -> runSimplePost(api.applyForJob(jobId), "Applied!"));
            card.addView(btnApply);
        } else {
            Button btnFund = new Button(this);
            btnFund.setText("Fund Escrow");
            btnFund.setOnClickListener(v -> runSimplePost(api.fundJob(jobId), "Job funded into escrow!"));
            card.addView(btnFund);

            Button btnShowQr = new Button(this);
            btnShowQr.setText("Generate Check-In QR");
            btnShowQr.setOnClickListener(v -> fetchAndShowQr(jobId));
            card.addView(btnShowQr);

            Button btnCheckIn = new Button(this);
            btnCheckIn.setText("Worker Check-In (Paste QR)");
            btnCheckIn.setOnClickListener(v -> promptCheckIn(jobId, lat, lng));
            card.addView(btnCheckIn);

            Button btnCheckOut = new Button(this);
            btnCheckOut.setText("Worker Check-Out");
            btnCheckOut.setOnClickListener(v -> runSimplePost(api.checkOut(jobId), "Checked out!"));
            card.addView(btnCheckOut);

            Button btnApprove = new Button(this);
            btnApprove.setText("Approve and Release Escrow");
            btnApprove.setOnClickListener(v -> runSimplePost(api.approveShift(jobId), "Escrow released to worker!"));
            card.addView(btnApprove);
        }

        llJobsContainer.addView(card);
    }

    private void fetchAndShowQr(String jobId) {
        api.getCheckinQr(jobId).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject body = response.body();
                    String payload = body.has("qr_payload") ? body.get("qr_payload").getAsString() : body.toString();
                    showQrDialog(payload);
                } else {
                    String msg = "QR unavailable (" + response.code() + "): " + readError(response);
                    tvFeedMessage.setText(msg);
                    Toast.makeText(HomeActivity.this, msg, Toast.LENGTH_LONG).show();
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                Toast.makeText(HomeActivity.this, "Error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void showQrDialog(String payload) {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(32, 24, 32, 16);

        try {
            BarcodeEncoder encoder = new BarcodeEncoder();
            Bitmap bitmap = encoder.encodeBitmap(payload, BarcodeFormat.QR_CODE, 500, 500);
            ImageView iv = new ImageView(this);
            iv.setImageBitmap(bitmap);
            layout.addView(iv);
        } catch (Exception ignored) {
        }

        TextView tvRaw = new TextView(this);
        tvRaw.setText(payload);
        tvRaw.setTextSize(11f);
        layout.addView(tvRaw);

        new AlertDialog.Builder(this)
                .setTitle("Signed Shift Check-In QR")
                .setView(layout)
                .setPositiveButton("Copy Payload", (d, w) -> {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) {
                        cm.setPrimaryClip(ClipData.newPlainText("qr_payload", payload));
                    }
                    Toast.makeText(this, "QR payload copied", Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Close", null)
                .show();
    }

    private void promptCheckIn(String jobId, double lat, double lng) {
        EditText input = new EditText(this);
        input.setHint("Paste signed QR JSON payload");
        new AlertDialog.Builder(this)
                .setTitle("Worker Check-In")
                .setView(input)
                .setPositiveButton("Submit Check-In", (d, w) -> {
                    JsonObject body = new JsonObject();
                    body.addProperty("qr_payload", input.getText().toString().trim());
                    body.addProperty("lat", lat);
                    body.addProperty("lng", lng);
                    runSimplePost(api.checkIn(jobId, body), "Checked in! Shift timer started.");
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void runSimplePost(Call<JsonObject> call, String successMsg) {
        call.enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (response.isSuccessful()) {
                    tvFeedMessage.setText(successMsg);
                    Toast.makeText(HomeActivity.this, successMsg, Toast.LENGTH_SHORT).show();
                    loadAccount();
                    loadJobs();
                } else {
                    String msg = "Action failed (" + response.code() + "): " + readError(response);
                    tvFeedMessage.setText(msg);
                    Toast.makeText(HomeActivity.this, msg, Toast.LENGTH_LONG).show();
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                tvFeedMessage.setText("Network error: " + t.getMessage());
                Toast.makeText(HomeActivity.this, "Network error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
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

    private String getStr(JsonObject obj, String key, String fallback) {
        return obj.has(key) && !obj.get(key).isJsonNull() ? obj.get(key).getAsString() : fallback;
    }
}
