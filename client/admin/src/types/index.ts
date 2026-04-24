export interface User {
  id: string;
  email: string;
  studentId: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface Item {
  id: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  pricePerDay: number;
  securityDeposit: number;
  images: string[];
  isAvailable: boolean;
  isActive: boolean;
  owner: {
    id: string;
    firstName: string;
    lastName: string;
  };
  createdAt: string;
}

export interface Rental {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  totalPrice: number;
  item: {
    id: string;
    title: string;
  };
  renter: {
    id: string;
    firstName: string;
    lastName: string;
  };
  createdAt: string;
}

export interface Verification {
  id: string;
  decision: "APPROVED" | "PENDING" | "RETRY" | "REJECTED";
  confidenceScore: number;
  status: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  status: string;
  paymentMethod: string;
  paymentReferenceNo?: string;
  paidAt?: string;
  createdAt: string;
  rental: {
    id: string;
    item: { id: string; title: string };
  };
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

export interface DashboardStats {
  totalUsers: number;
  totalItems: number;
  activeRentals: number;
  pendingVerifications: number;
  totalRevenue: number;
}
