package com.hourledger.app;

import android.os.Bundle;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;
import com.google.gson.JsonObject;
import com.hourledger.app.network.ApiClient;
import com.hourledger.app.network.HourLedgerApi;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class CreateJobActivity extends AppCompatActivity {

    private EditText etJobTitle, etJobDescription, etJobCategory, etHourlyRateRupees, etDurationHours, etAddress, etLat, etLng;
    private TextView tvCreateStatus;
    private HourLedgerApi api;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_create_job);

        api = ApiClient.getInstance(this).create(HourLedgerApi.class);

        etJobTitle = findViewById(R.id.etJobTitle);
        etJobDescription = findViewById(R.id.etJobDescription);
        etJobCategory = findViewById(R.id.etJobCategory);
        etHourlyRateRupees = findViewById(R.id.etHourlyRateRupees);
        etDurationHours = findViewById(R.id.etDurationHours);
        etAddress = findViewById(R.id.etAddress);
        etLat = findViewById(R.id.etLat);
        etLng = findViewById(R.id.etLng);
        tvCreateStatus = findViewById(R.id.tvCreateStatus);

        findViewById(R.id.btnBackHome).setOnClickListener(v -> finish());
        findViewById(R.id.btnSubmitJob).setOnClickListener(v -> submitJob());
    }

    private void submitJob() {
        String title = etJobTitle.getText().toString().trim();
        String description = etJobDescription.getText().toString().trim();
        String category = etJobCategory.getText().toString().trim();
        String rateRaw = etHourlyRateRupees.getText().toString().trim();
        String durationRaw = etDurationHours.getText().toString().trim();
        String address = etAddress.getText().toString().trim();
        String latRaw = etLat.getText().toString().trim();
        String lngRaw = etLng.getText().toString().trim();

        if (title.isEmpty() || rateRaw.isEmpty() || durationRaw.isEmpty()) {
            tvCreateStatus.setText("Please fill in title, hourly rate, and duration.");
            return;
        }

        long hourlyRatePaise = Long.parseLong(rateRaw) * 100L;
        int durationHours = Integer.parseInt(durationRaw);
        double lat = latRaw.isEmpty() ? 12.8700 : Double.parseDouble(latRaw);
        double lng = lngRaw.isEmpty() ? 74.8426 : Double.parseDouble(lngRaw);

        // ISO-8601 start timestamp 30 minutes from now
        long startMillis = System.currentTimeMillis() + (30L * 60L * 1000L);
        SimpleDateFormat isoFormat = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        isoFormat.setTimeZone(TimeZone.getTimeZone("UTC"));
        String scheduledStart = isoFormat.format(new Date(startMillis));

        JsonObject body = new JsonObject();
        body.addProperty("title", title);
        body.addProperty("description", description.isEmpty() ? title : description);
        body.addProperty("category", category.isEmpty() ? "retail" : category);
        body.addProperty("hourly_rate_paise", hourlyRatePaise);
        body.addProperty("duration_hours", durationHours);
        body.addProperty("address", address);
        body.addProperty("lat", lat);
        body.addProperty("lng", lng);
        body.addProperty("scheduled_start", scheduledStart);

        tvCreateStatus.setText("Publishing shift...");

        api.createJob(body).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (response.isSuccessful()) {
                    Toast.makeText(CreateJobActivity.this, "Job published!", Toast.LENGTH_SHORT).show();
                    finish();
                } else {
                    String err = "";
                    try {
                        if (response.errorBody() != null) {
                            err = response.errorBody().string();
                        }
                    } catch (Exception ignored) {
                    }
                    tvCreateStatus.setText("Failed (" + response.code() + "): " + err);
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                tvCreateStatus.setText("Network error: " + t.getMessage());
            }
        });
    }
}
