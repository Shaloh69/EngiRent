"use client";

import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Button,
  Input,
  Spinner,
} from "@heroui/react";
import { Search, UserCheck, UserX, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import type { User } from "@/types";

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/admin/users");
      setUsers(response.data.data?.users || []);
    } catch (apiError: any) {
      setError(apiError?.response?.data?.error || "Failed to fetch users.");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      await api.patch(`/admin/users/${userId}`, { isActive: !currentStatus });
      await fetchUsers();
    } catch (apiError: any) {
      setError(
        apiError?.response?.data?.error || "Failed to update user status.",
      );
    }
  };

  const filteredUsers = useMemo(
    () =>
      users.filter((user) => {
        const term = search.toLowerCase();
        return (
          user.email.toLowerCase().includes(term) ||
          user.firstName.toLowerCase().includes(term) ||
          user.lastName.toLowerCase().includes(term) ||
          user.studentId.includes(search)
        );
      }),
    [users, search],
  );

  return (
    <AdminLayout>
      <div className="space-y-5 sm:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] app-muted">
              Accounts
            </p>
            <h1 className="text-2xl font-extrabold text-[var(--color-ink)] sm:text-3xl">
              User Management
            </h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Search users"
              placeholder="Search users"
              startContent={<Search size={18} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-80"
              variant="bordered"
            />
            <Button
              variant="flat"
              startContent={<RefreshCw size={16} />}
              onPress={fetchUsers}
            >
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}

        <div className="app-surface overflow-x-auto rounded-2xl border border-[var(--color-border)] p-3 sm:p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner label="Loading users..." />
            </div>
          ) : (
            <Table aria-label="Users table" removeWrapper>
              <TableHeader>
                <TableColumn>NAME</TableColumn>
                <TableColumn>EMAIL</TableColumn>
                <TableColumn>STUDENT ID</TableColumn>
                <TableColumn>PHONE</TableColumn>
                <TableColumn>STATUS</TableColumn>
                <TableColumn>VERIFIED</TableColumn>
                <TableColumn>ACTIONS</TableColumn>
              </TableHeader>
              <TableBody emptyContent="No users found.">
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-semibold">
                      {user.firstName} {user.lastName}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.studentId}</TableCell>
                    <TableCell>{user.phoneNumber || "N/A"}</TableCell>
                    <TableCell>
                      <Chip
                        color={user.isActive ? "success" : "danger"}
                        size="sm"
                      >
                        {user.isActive ? "Active" : "Inactive"}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <Chip
                        color={user.isVerified ? "success" : "warning"}
                        size="sm"
                      >
                        {user.isVerified ? "Verified" : "Unverified"}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        color={user.isActive ? "danger" : "success"}
                        variant="flat"
                        startContent={
                          user.isActive ? (
                            <UserX size={16} />
                          ) : (
                            <UserCheck size={16} />
                          )
                        }
                        onPress={() => toggleUserStatus(user.id, user.isActive)}
                      >
                        {user.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
