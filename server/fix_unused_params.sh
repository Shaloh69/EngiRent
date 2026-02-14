#!/bin/bash

# Fix unused parameters by prefixing with underscore
sed -i 's/req: AuthRequest, res: Response, next:/req: AuthRequest, _res: Response, next:/g' src/middleware/auth.ts
sed -i 's/err: Error, req: Request, res: Response, next: NextFunction/err: Error, _req: Request, res: Response, _next: NextFunction/g' src/middleware/errorHandler.ts
sed -i 's/req: Request, res: Response, next: NextFunction/req: Request, _res: Response, next: NextFunction/g' src/middleware/validation.ts
sed -i "s/(req, res) =>/(_req, res) =>/g" src/routes/index.ts

echo "✅ Fixed unused parameters"
