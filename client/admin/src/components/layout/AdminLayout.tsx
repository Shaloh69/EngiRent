'use client'

import { usePathname, useRouter } from 'next/navigation';
import {
  Navbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem,
  Button,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from '@heroui/react';
import {
  LayoutDashboard,
  Users,
  Package,
  Receipt,
  CheckCircle2,
  BarChart3,
  LogOut,
  User as UserIcon,
} from 'lucide-react';
import Link from 'next/link';

const menuItems = [
  { name: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { name: 'Users', icon: Users, href: '/users' },
  { name: 'Items', icon: Package, href: '/items' },
  { name: 'Rentals', icon: Receipt, href: '/rentals' },
  { name: 'Verifications', icon: CheckCircle2, href: '/verifications' },
  { name: 'Reports', icon: BarChart3, href: '/reports' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar maxWidth="full" className="border-b">
        <NavbarBrand>
          <p className="font-bold text-xl">EngiRent Admin</p>
        </NavbarBrand>
        <NavbarContent className="hidden sm:flex gap-4" justify="center">
          {menuItems.map((item) => (
            <NavbarItem key={item.href} isActive={pathname === item.href}>
              <Link
                href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                  pathname === item.href
                    ? 'bg-primary text-white'
                    : 'hover:bg-gray-100'
                }`}
              >
                <item.icon size={18} />
                {item.name}
              </Link>
            </NavbarItem>
          ))}
        </NavbarContent>
        <NavbarContent justify="end">
          <Dropdown>
            <DropdownTrigger>
              <Button isIconOnly variant="light">
                <UserIcon size={20} />
              </Button>
            </DropdownTrigger>
            <DropdownMenu>
              <DropdownItem
                key="logout"
                onClick={handleLogout}
                startContent={<LogOut size={16} />}
                color="danger"
              >
                Logout
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </NavbarContent>
      </Navbar>
      
      <main className="container mx-auto p-6">{children}</main>
    </div>
  );
}
