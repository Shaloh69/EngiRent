import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import type { Item, Rental, User, Verification } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
const demoEnv = process.env.NEXT_PUBLIC_DEMO_MODE;
export const isDemoMode =
  process.env.NODE_ENV !== "production" && demoEnv !== "false";

const nowIso = new Date().toISOString();

const demoState: {
  users: User[];
  items: Item[];
  rentals: Rental[];
  verifications: Verification[];
} = {
  users: [
    {
      id: "user-001",
      email: "ian.luna@uclm.edu.ph",
      studentId: "2019-001",
      firstName: "Ian",
      lastName: "Luna",
      phoneNumber: "09171234567",
      isVerified: true,
      isActive: true,
      createdAt: nowIso,
    },
    {
      id: "user-002",
      email: "allan.mondejar@uclm.edu.ph",
      studentId: "2019-002",
      firstName: "Allan",
      lastName: "Mondejar",
      phoneNumber: "09182345678",
      isVerified: true,
      isActive: true,
      createdAt: nowIso,
    },
    {
      id: "user-003",
      email: "mcjerrel.abala@uclm.edu.ph",
      studentId: "2019-003",
      firstName: "Mc Jerrel",
      lastName: "Abala",
      phoneNumber: "09193456789",
      isVerified: false,
      isActive: false,
      createdAt: nowIso,
    },
  ],
  items: [
    {
      id: "item-001",
      title: "Scientific Calculator FX-991ES",
      description: "Engineering-ready scientific calculator.",
      category: "ACADEMIC_TOOLS",
      condition: "GOOD",
      pricePerDay: 45,
      securityDeposit: 250,
      images: ["demo-calc.jpg"],
      isAvailable: true,
      isActive: true,
      owner: { id: "user-001", firstName: "Ian", lastName: "Luna" },
      createdAt: nowIso,
    },
    {
      id: "item-002",
      title: "Arduino Starter Kit",
      description: "Uno + breadboard + sensors and jumpers.",
      category: "DEVELOPMENT_KITS",
      condition: "LIKE_NEW",
      pricePerDay: 95,
      securityDeposit: 700,
      images: ["demo-arduino.jpg"],
      isAvailable: false,
      isActive: true,
      owner: { id: "user-002", firstName: "Allan", lastName: "Mondejar" },
      createdAt: nowIso,
    },
  ],
  rentals: [
    {
      id: "rental-001",
      status: "ACTIVE",
      startDate: new Date(Date.now() - 86400000).toISOString(),
      endDate: new Date(Date.now() + 172800000).toISOString(),
      totalPrice: 190,
      item: { id: "item-002", title: "Arduino Starter Kit" },
      renter: { id: "user-001", firstName: "Ian", lastName: "Luna" },
      createdAt: nowIso,
    },
    {
      id: "rental-002",
      status: "VERIFICATION",
      startDate: new Date(Date.now() - 5 * 86400000).toISOString(),
      endDate: new Date(Date.now() - 86400000).toISOString(),
      totalPrice: 180,
      item: { id: "item-001", title: "Scientific Calculator FX-991ES" },
      renter: { id: "user-002", firstName: "Allan", lastName: "Mondejar" },
      createdAt: nowIso,
    },
  ],
  verifications: [
    {
      id: "ver-001",
      decision: "PENDING",
      confidenceScore: 74.2,
      status: "MANUAL_REVIEW",
      createdAt: nowIso,
    },
    {
      id: "ver-002",
      decision: "APPROVED",
      confidenceScore: 93.8,
      status: "APPROVED",
      createdAt: nowIso,
    },
  ],
};

const parseBody = (config: AxiosRequestConfig): Record<string, any> => {
  if (!config.data) return {};
  if (typeof config.data === "string") {
    try {
      return JSON.parse(config.data);
    } catch {
      return {};
    }
  }
  return config.data as Record<string, any>;
};

const jsonResponse = (
  config: AxiosRequestConfig,
  data: Record<string, any>,
  status = 200,
): AxiosResponse<Record<string, any>> => ({
  data,
  status,
  statusText: status >= 200 && status < 300 ? "OK" : "ERROR",
  headers: {},
  config: config as any,
});

const demoAdapter = async (
  config: AxiosRequestConfig,
): Promise<AxiosResponse<Record<string, any>>> => {
  const method = (config.method || "get").toLowerCase();
  const path = (config.url || "").split("?")[0];
  const body = parseBody(config);

  if (method === "post" && path === "/auth/login") {
    if (!body.email || !body.password) {
      return jsonResponse(
        config,
        { success: false, error: "Email and password are required" },
        400,
      );
    }
    return jsonResponse(config, {
      success: true,
      data: {
        user: demoState.users[0],
        tokens: {
          accessToken: "demo-admin-token",
          refreshToken: "demo-admin-refresh",
        },
      },
    });
  }

  // Admin stats
  if (method === "get" && path === "/admin/stats") {
    return jsonResponse(config, {
      success: true,
      data: {
        totalUsers: demoState.users.length,
        totalItems: demoState.items.length,
        activeRentals: demoState.rentals.filter((r) => r.status === "ACTIVE")
          .length,
        pendingVerifications: demoState.verifications.filter(
          (v) => v.status === "MANUAL_REVIEW",
        ).length,
        completedRentals: demoState.rentals.filter(
          (r) => r.status === "COMPLETED",
        ).length,
        totalRevenue: demoState.rentals.reduce(
          (sum, r) => sum + (r.totalPrice || 0),
          0,
        ),
      },
    });
  }

  if (method === "get" && (path === "/admin/users" || path === "/users")) {
    return jsonResponse(config, {
      success: true,
      data: { users: demoState.users },
    });
  }

  if (
    method === "patch" &&
    (path.startsWith("/admin/users/") || path.startsWith("/users/"))
  ) {
    const userId = path.replace("/admin/users/", "").replace("/users/", "");
    demoState.users = demoState.users.map((user) =>
      user.id === userId ? { ...user, isActive: Boolean(body.isActive) } : user,
    );
    return jsonResponse(config, { success: true, message: "User updated" });
  }

  if (method === "get" && path === "/items") {
    return jsonResponse(config, {
      success: true,
      data: { items: demoState.items },
    });
  }

  if (method === "delete" && path.startsWith("/items/")) {
    const itemId = path.replace("/items/", "");
    demoState.items = demoState.items.filter((item) => item.id !== itemId);
    return jsonResponse(config, { success: true, message: "Item deleted" });
  }

  if (method === "get" && (path === "/admin/rentals" || path === "/rentals")) {
    return jsonResponse(config, {
      success: true,
      data: { rentals: demoState.rentals },
    });
  }

  if (
    method === "get" &&
    (path === "/admin/verifications" || path === "/verifications")
  ) {
    return jsonResponse(config, {
      success: true,
      data: { verifications: demoState.verifications },
    });
  }

  if (
    method === "patch" &&
    (path.startsWith("/admin/verifications/") ||
      path.startsWith("/verifications/"))
  ) {
    const verificationId = path
      .replace("/admin/verifications/", "")
      .replace("/verifications/", "");
    demoState.verifications = demoState.verifications.map((verification) =>
      verification.id === verificationId
        ? {
            ...verification,
            status: body.status || verification.status,
            decision:
              body.status === "APPROVED"
                ? "APPROVED"
                : body.status === "REJECTED"
                  ? "REJECTED"
                  : verification.decision,
          }
        : verification,
    );
    return jsonResponse(config, {
      success: true,
      message: "Verification updated",
    });
  }

  // Transactions
  if (method === "get" && path === "/admin/transactions") {
    return jsonResponse(config, {
      success: true,
      data: {
        transactions: [],
        pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
      },
    });
  }

  if (method === "post" && path.match(/\/admin\/transactions\/.+\/refund/)) {
    return jsonResponse(config, { success: true, message: "Refund issued" });
  }

  // Dispute settlement
  if (method === "post" && path.match(/\/admin\/rentals\/.+\/settle/)) {
    return jsonResponse(config, { success: true, message: "Dispute settled" });
  }

  // Kiosk admin endpoints
  if (method === "get" && path === "/admin/kiosks") {
    return jsonResponse(config, {
      success: true,
      data: { kiosks: [{ id: "kiosk-1" }] },
    });
  }

  if (method === "get" && path.match(/\/admin\/kiosks\/.+\/config/)) {
    return jsonResponse(config, {
      success: true,
      data: { config: { lockers: {} } },
    });
  }

  if (method === "put" && path.match(/\/admin\/kiosks\/.+\/config/)) {
    return jsonResponse(config, { success: true, message: "Config updated" });
  }

  if (method === "post" && path.match(/\/admin\/kiosks\/.+\/command/)) {
    return jsonResponse(config, { success: true, message: "Command sent" });
  }

  return jsonResponse(
    config,
    {
      success: false,
      error: `No demo route for ${method.toUpperCase()} ${path}`,
    },
    404,
  );
};

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("admin_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }

  if (isDemoMode) {
    config.adapter = demoAdapter as any;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!isDemoMode && error.response?.status === 401) {
      localStorage.removeItem("admin_token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

export default api;
