# EngiRent Admin Console

Next.js admin dashboard for managing the EngiRent Hub IoT-powered Smart Kiosk System.

## Features

✅ **Dashboard** - Real-time statistics and overview
✅ **User Management** - View, activate/deactivate users
✅ **Item Management** - Moderate item listings
✅ **Rental Oversight** - Monitor all rentals
✅ **AI Verification Review** - Approve/reject verifications
✅ **Reports & Analytics** - Revenue and usage analytics

## Tech Stack

- **Next.js 15** - React framework with App Router
- **HeroUI (NextUI) v2.6.10** - Modern React UI library
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Recharts** - Data visualization
- **Zustand** - State management
- **Axios** - HTTP client

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001)

### 4. Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
src/
├── app/
│   ├── dashboard/     # Main dashboard
│   ├── users/         # User management
│   ├── items/         # Item management
│   ├── rentals/       # Rental oversight
│   ├── verifications/ # AI verification review
│   ├── reports/       # Analytics
│   └── login/         # Authentication
├── components/
│   ├── layout/        # Layout components
│   ├── charts/        # Chart components
│   └── tables/        # Table components
├── lib/
│   └── api.ts         # API client
└── types/
    └── index.ts       # TypeScript types
```

## Features

### Dashboard
- Total users, items, active rentals
- Pending verifications count
- Total revenue
- Recent rentals table

### User Management
- View all users
- Search by name, email, student ID
- Activate/deactivate accounts
- View verification status

### Item Management
- Browse all items
- Filter by category
- Search items
- View item details
- Delete inappropriate items

### Rental Management
- View all rentals
- Filter by status
- Monitor active rentals
- Track rental history

### Verification Review
- Review pending AI verifications
- View confidence scores
- Approve/reject verifications
- Manual override capability

### Reports & Analytics
- Monthly revenue trends
- Rental volume charts
- Category distribution
- Performance metrics

## API Integration

The admin console connects to the EngiRent backend API:
- Base URL: `http://localhost:5000/api/v1`
- Authentication: JWT Bearer tokens
- Auto-refresh on token expiry

## Authentication

Default login: Use backend user credentials
- Admins log in with same endpoint as regular users
- Access control can be added via user roles

## Documentation

- [HeroUI Docs](https://www.heroui.com/docs)
- [Next.js Docs](https://nextjs.org/docs)
- [Recharts Docs](https://recharts.org/)

## License

MIT

---

Built with ❤️ for UCLM Engineering Students
