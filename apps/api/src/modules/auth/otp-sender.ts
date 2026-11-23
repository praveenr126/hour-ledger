export interface OtpSender {
  sendOtp(phone: string, code: string): Promise<void>;
}

export class MockOtpSender implements OtpSender {
  async sendOtp(_phone: string, _code: string): Promise<void> {
    // Dev mock: code is returned in the API response when DEV_SHOW_OTP=true.
    // Interface matches a real SMS provider for future replacement.
  }
}
