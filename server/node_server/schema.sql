-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `phoneNumber` VARCHAR(191) NOT NULL,
    `profileImage` VARCHAR(191) NULL,
    `faceEncoding` JSON NULL,
    `idImageUrl` VARCHAR(191) NULL,
    `profileComplete` BOOLEAN NOT NULL DEFAULT false,
    `biometricConsentAt` DATETIME(3) NULL,
    `parentName` VARCHAR(191) NULL,
    `parentContact` VARCHAR(191) NULL,
    `payoutProvider` VARCHAR(191) NULL,
    `payoutBic` VARCHAR(191) NULL,
    `payoutInstitutionName` VARCHAR(191) NULL,
    `payoutAccountName` VARCHAR(191) NULL,
    `payoutAccountNumber` JSON NULL,
    `isVerified` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `emailVerifiedAt` DATETIME(3) NULL,
    `role` ENUM('STUDENT', 'ADMIN') NOT NULL DEFAULT 'STUDENT',
    `refreshToken` TEXT NULL,
    `lastLogin` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_studentId_key`(`studentId`),
    INDEX `users_email_idx`(`email`),
    INDEX `users_studentId_idx`(`studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `items` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `category` ENUM('SCHOOL_ATTIRE', 'ACADEMIC_TOOLS', 'ELECTRONICS', 'DEVELOPMENT_KITS', 'MEASUREMENT_TOOLS', 'AUDIO_VISUAL', 'SPORTS_EQUIPMENT', 'OTHER') NOT NULL,
    `condition` ENUM('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'ACCEPTABLE') NOT NULL,
    `pricePerDay` DOUBLE NOT NULL,
    `pricePerWeek` DOUBLE NULL,
    `pricePerMonth` DOUBLE NULL,
    `securityDeposit` DOUBLE NOT NULL,
    `images` JSON NOT NULL,
    `mlFeatures` JSON NULL,
    `serialNumber` VARCHAR(191) NULL,
    `isAvailable` BOOLEAN NOT NULL DEFAULT true,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `campusLocation` VARCHAR(191) NULL,
    `totalRentals` INTEGER NOT NULL DEFAULT 0,
    `averageRating` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `items_ownerId_idx`(`ownerId`),
    INDEX `items_category_idx`(`category`),
    INDEX `items_isAvailable_idx`(`isAvailable`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rentals` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `renterId` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `actualReturnDate` DATETIME(3) NULL,
    `status` ENUM('PENDING', 'AWAITING_DEPOSIT', 'DEPOSITED', 'ACTIVE', 'VERIFICATION', 'COMPLETED', 'CANCELLED', 'DISPUTED') NOT NULL DEFAULT 'PENDING',
    `totalPrice` DOUBLE NOT NULL,
    `securityDeposit` DOUBLE NOT NULL,
    `depositLockerId` VARCHAR(191) NULL,
    `claimLockerId` VARCHAR(191) NULL,
    `returnLockerId` VARCHAR(191) NULL,
    `depositVerificationId` VARCHAR(191) NULL,
    `verificationId` VARCHAR(191) NULL,
    `verificationScore` DOUBLE NULL,
    `verificationStatus` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'MANUAL_REVIEW', 'APPROVED', 'REJECTED') NULL,
    `depositAttemptCount` INTEGER NOT NULL DEFAULT 0,
    `returnAttemptCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `depositedAt` DATETIME(3) NULL,
    `claimedAt` DATETIME(3) NULL,
    `returnedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `rentals_depositVerificationId_key`(`depositVerificationId`),
    UNIQUE INDEX `rentals_verificationId_key`(`verificationId`),
    INDEX `rentals_itemId_idx`(`itemId`),
    INDEX `rentals_renterId_idx`(`renterId`),
    INDEX `rentals_ownerId_idx`(`ownerId`),
    INDEX `rentals_status_idx`(`status`),
    INDEX `rentals_status_endDate_idx`(`status`, `endDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transactions` (
    `id` VARCHAR(191) NOT NULL,
    `rentalId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('RENTAL_PAYMENT', 'SECURITY_DEPOSIT', 'DEPOSIT_REFUND', 'LATE_FEE', 'DAMAGE_FEE', 'OWNER_PAYOUT') NOT NULL,
    `amount` DOUBLE NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `paymentReferenceNo` VARCHAR(191) NULL,
    `paymentTransactionId` VARCHAR(191) NULL,
    `paymongoPaymentId` VARCHAR(191) NULL,
    `paymongoCheckoutId` VARCHAR(191) NULL,
    `paymentMethod` VARCHAR(191) NOT NULL DEFAULT 'PayMongo',
    `paymentDetails` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `paidAt` DATETIME(3) NULL,

    UNIQUE INDEX `transactions_paymentReferenceNo_key`(`paymentReferenceNo`),
    UNIQUE INDEX `transactions_paymentTransactionId_key`(`paymentTransactionId`),
    UNIQUE INDEX `transactions_paymongoCheckoutId_key`(`paymongoCheckoutId`),
    INDEX `transactions_rentalId_idx`(`rentalId`),
    INDEX `transactions_userId_idx`(`userId`),
    INDEX `transactions_paymentReferenceNo_idx`(`paymentReferenceNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verifications` (
    `id` VARCHAR(191) NOT NULL,
    `originalImages` JSON NOT NULL,
    `kioskImages` JSON NOT NULL,
    `decision` ENUM('APPROVED', 'PENDING', 'RETRY', 'REJECTED') NOT NULL,
    `confidenceScore` DOUBLE NOT NULL,
    `attemptNumber` INTEGER NOT NULL DEFAULT 1,
    `traditionalScore` DOUBLE NULL,
    `siftScore` DOUBLE NULL,
    `deepLearningScore` DOUBLE NULL,
    `ocrMatch` BOOLEAN NULL,
    `ocrDetails` JSON NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'MANUAL_REVIEW', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewedBy` VARCHAR(191) NULL,
    `reviewNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `verifications_decision_idx`(`decision`),
    INDEX `verifications_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lockers` (
    `id` VARCHAR(191) NOT NULL,
    `lockerNumber` VARCHAR(191) NOT NULL,
    `kioskId` VARCHAR(191) NOT NULL,
    `size` ENUM('SMALL', 'MEDIUM', 'LARGE', 'EXTRA_LARGE') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE', 'OUT_OF_SERVICE') NOT NULL DEFAULT 'AVAILABLE',
    `isOperational` BOOLEAN NOT NULL DEFAULT true,
    `currentRentalId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,

    UNIQUE INDEX `lockers_lockerNumber_key`(`lockerNumber`),
    INDEX `lockers_kioskId_idx`(`kioskId`),
    INDEX `lockers_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kiosk_configs` (
    `id` VARCHAR(191) NOT NULL,
    `kioskId` VARCHAR(191) NOT NULL,
    `config` JSON NOT NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `kiosk_configs_kioskId_key`(`kioskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `type` ENUM('BOOKING_CONFIRMED', 'DEPOSIT_REMINDER', 'ITEM_READY_FOR_CLAIM', 'CLAIM_REMINDER', 'RENTAL_STARTED', 'RETURN_REMINDER', 'RETURN_OVERDUE', 'VERIFICATION_SUCCESS', 'VERIFICATION_FAILED', 'PAYMENT_RECEIVED', 'PAYMENT_FAILED', 'REVIEW_REQUEST', 'SYSTEM_ANNOUNCEMENT') NOT NULL,
    `relatedEntityId` VARCHAR(191) NULL,
    `relatedEntityType` VARCHAR(191) NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_idx`(`userId`),
    INDEX `notifications_isRead_idx`(`isRead`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviews` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `rentalId` VARCHAR(191) NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `rating` INTEGER NOT NULL,
    `comment` TEXT NULL,
    `reviewType` ENUM('ITEM', 'USER') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `reviews_itemId_idx`(`itemId`),
    INDEX `reviews_authorId_idx`(`authorId`),
    INDEX `reviews_recipientId_idx`(`recipientId`),
    UNIQUE INDEX `reviews_rentalId_authorId_reviewType_key`(`rentalId`, `authorId`, `reviewType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `items` ADD CONSTRAINT `items_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_renterId_fkey` FOREIGN KEY (`renterId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_depositVerificationId_fkey` FOREIGN KEY (`depositVerificationId`) REFERENCES `verifications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_verificationId_fkey` FOREIGN KEY (`verificationId`) REFERENCES `verifications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_depositLockerId_fkey` FOREIGN KEY (`depositLockerId`) REFERENCES `lockers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_claimLockerId_fkey` FOREIGN KEY (`claimLockerId`) REFERENCES `lockers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_returnLockerId_fkey` FOREIGN KEY (`returnLockerId`) REFERENCES `lockers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_rentalId_fkey` FOREIGN KEY (`rentalId`) REFERENCES `rentals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_rentalId_fkey` FOREIGN KEY (`rentalId`) REFERENCES `rentals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

