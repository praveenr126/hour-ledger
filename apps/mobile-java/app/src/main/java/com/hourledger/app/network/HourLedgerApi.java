package com.hourledger.app.network;

import com.google.gson.JsonObject;
import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.GET;
import retrofit2.http.POST;
import retrofit2.http.Path;
import retrofit2.http.Query;

public interface HourLedgerApi {

    @POST("auth/otp/request")
    Call<JsonObject> requestOtp(@Body JsonObject body);

    @POST("auth/otp/verify")
    Call<JsonObject> verifyOtp(@Body JsonObject body);

    @GET("me")
    Call<JsonObject> getMe();

    @POST("wallet/topup")
    Call<JsonObject> topUpWallet(@Body JsonObject body);

    @GET("wallet/ledger")
    Call<JsonObject> getWalletLedger();

    @GET("jobs")
    Call<JsonObject> listJobs(
            @Query("status") String status,
            @Query("lat") Double lat,
            @Query("lng") Double lng
    );

    @GET("jobs/mine")
    Call<JsonObject> getMyJobs();

    @POST("jobs")
    Call<JsonObject> createJob(@Body JsonObject body);

    @POST("jobs/{id}/apply")
    Call<JsonObject> applyForJob(@Path("id") String jobId);

    @POST("jobs/{id}/fund")
    Call<JsonObject> fundJob(@Path("id") String jobId);

    @GET("jobs/{id}/checkin-qr")
    Call<JsonObject> getCheckinQr(@Path("id") String jobId);

    @POST("jobs/{id}/checkin")
    Call<JsonObject> checkIn(@Path("id") String jobId, @Body JsonObject body);

    @POST("jobs/{id}/checkout")
    Call<JsonObject> checkOut(@Path("id") String jobId);

    @POST("jobs/{id}/approve")
    Call<JsonObject> approveShift(@Path("id") String jobId);
}
