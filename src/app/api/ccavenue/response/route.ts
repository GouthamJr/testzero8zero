import { NextRequest } from "next/server";
import { decrypt } from "@/lib/ccavenue";

const OBD_API = "https://obd3api.expressivr.com";
const RESELLER_USERNAME = "Cloudcentral";
const RESELLER_PASSWORD = "Admin@123";
const RESELLER_USERID = "500099";

async function getResellerToken(): Promise<string | null> {
  try {
    const loginRes = await fetch(`${OBD_API}/api/obd/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: RESELLER_USERNAME, password: RESELLER_PASSWORD }),
    });
    const loginData = await loginRes.json();
    return loginData?.token || null;
  } catch (err) {
    console.error("Failed to get reseller token:", err);
    return null;
  }
}

async function getUserProfile(token: string, userId: string) {
  const res = await fetch(`${OBD_API}/api/obd/user/profile/${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function addCredits(token: string, userId: string, credits: string) {
  const res = await fetch(`${OBD_API}/api/obd/credits/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId: Number(userId), parent: RESELLER_USERID, credits }),
  });
  const data = await res.json();
  console.log("Credits added:", data);
  return res.ok;
}

async function removeCredits(token: string, userId: string, credits: string) {
  const res = await fetch(`${OBD_API}/api/obd/credits/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId: Number(userId), parent: RESELLER_USERID, credits }),
  });
  const data = await res.json();
  console.log("Credits removed:", data);
  return res.ok;
}

async function updateUserPlan(token: string, profile: Record<string, unknown>, newPlanId: string) {
  const res = await fetch(`${OBD_API}/api/obd/user/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      userId: profile.userId,
      username: profile.username,
      password: profile.username,
      parent: RESELLER_USERID,
      name: profile.name || "NA",
      emailid: profile.emailid || profile.email || "NA",
      number: profile.number || "NA",
      company: profile.company || "NA",
      address: profile.address || "NA",
      pincode: profile.pincode || "000000",
      planId: newPlanId,
      accountType: String(profile.accountType ?? "0"),
      expiryDate: profile.expiryDate || "2027-12-31 23:59:59",
      userType: "user",
      groupRows: JSON.stringify({ groupsList: [{ groupId: "34", groupName: "BLR_ALL" }] }),
      locationRows: JSON.stringify({ locationsList: [{ locationId: "3", locationName: "Bangalore" }] }),
      moduleId: "1",
      planType: "0",
    }),
  });
  const data = await res.json();
  console.log("User plan updated:", data);
  return res.ok;
}

async function processCreditsAndPlan(userId: string, newCredits: string, newPlanId: string): Promise<boolean> {
  try {
    const token = await getResellerToken();
    if (!token) return false;

    const profile = await getUserProfile(token, userId);
    const currentPlanId = String(profile.planId || "");
    const availableCredits = Number(profile.credits || 0);

    if (currentPlanId === newPlanId) {
      // Same plan — just add credits
      console.log(`Same plan ${newPlanId}, adding ${newCredits} credits`);
      return await addCredits(token, userId, newCredits);
    } else {
      // Different plan — remove existing credits, add new credits, update planId
      console.log(`Plan change: ${currentPlanId} → ${newPlanId}. Removing ${availableCredits} credits, adding ${newCredits}`);

      if (availableCredits > 0) {
        await removeCredits(token, userId, String(availableCredits));
      }

      const added = await addCredits(token, userId, newCredits);
      await updateUserPlan(token, profile, newPlanId);

      return added;
    }
  } catch (err) {
    console.error("Failed to process credits and plan:", err);
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    // Parse body as text first, then extract encResp — more reliable than formData()
    const body = await req.text();
    const bodyParams = new URLSearchParams(body);
    const encResp = bodyParams.get("encResp")?.trim();

    if (!encResp) {
      console.error("CCAvenue response: encResp is missing. Body:", body.substring(0, 200));
      return redirectTo("/dashboard/payment/failure?error=no_response");
    }

    const decrypted = decrypt(encResp);

    // Parse the response string into key-value pairs
    const params: Record<string, string> = {};
    decrypted.split("&").forEach((pair) => {
      const [key, ...valueParts] = pair.split("=");
      if (key) params[key.trim()] = valueParts.join("=");
    });

    const orderStatus = params.order_status;
    const orderId = params.order_id || "";
    const trackingId = params.tracking_id || "";
    const amount = params.amount || "";
    const planName = params.merchant_param1 || "";
    const calls = params.merchant_param2 || "";
    const days = params.merchant_param3 || "";
    const userId = params.merchant_param4 || "";
    const param5 = params.merchant_param5 || "";
    const [basePrice, planId] = param5.split("|");
    const statusMessage = params.status_message || "";

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;

    if (orderStatus === "Success") {
      // Process credits: same plan = add credits, different plan = reset credits + change plan
      if (userId && basePrice && planId) {
        await processCreditsAndPlan(userId, basePrice, planId);
      }

      const successParams = new URLSearchParams({
        order_id: orderId,
        tracking_id: trackingId,
        amount,
        plan: planName,
        calls,
        days,
        planId: planId || "",
      });
      return Response.redirect(
        `${baseUrl}/dashboard/payment/success?${successParams.toString()}`,
        303
      );
    } else {
      const failParams = new URLSearchParams({
        order_id: orderId,
        status: orderStatus || "Failed",
        message: statusMessage,
      });
      return Response.redirect(
        `${baseUrl}/dashboard/payment/failure?${failParams.toString()}`,
        303
      );
    }
  } catch (error) {
    console.error("CCAvenue response error:", error);
    return redirectTo("/dashboard/payment/failure?error=decrypt_failed");
  }
}

function redirectTo(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL!;
  return Response.redirect(`${baseUrl}${path}`, 303);
}
