CREATE TABLE `authSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`revokedAt` timestamp,
	`lastUsedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `authSessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_sessions_token_hash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `billingWebhookEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(32) NOT NULL DEFAULT 'stripe',
	`providerEventId` varchar(255) NOT NULL,
	`eventType` varchar(255) NOT NULL,
	`payload` json NOT NULL,
	`processedAt` timestamp,
	`failedAt` timestamp,
	`failureReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `billingWebhookEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `billing_webhook_events_provider_event_unique` UNIQUE(`provider`,`providerEventId`)
);
--> statement-breakpoint
CREATE TABLE `organizationInvitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('admin','estimator','viewer') NOT NULL DEFAULT 'estimator',
	`tokenHash` varchar(128) NOT NULL,
	`invitedByUserId` int NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`acceptedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `organizationInvitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organization_invitations_token_hash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `organizationMembers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','admin','estimator','viewer') NOT NULL DEFAULT 'estimator',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizationMembers_id` PRIMARY KEY(`id`),
	CONSTRAINT `organization_members_org_user_unique` UNIQUE(`organizationId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `organizationSubscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int NOT NULL,
	`planId` int NOT NULL,
	`status` enum('trialing','active','past_due','canceled','unpaid','incomplete','paused') NOT NULL DEFAULT 'trialing',
	`provider` varchar(32) NOT NULL DEFAULT 'stripe',
	`stripeCustomerId` varchar(255),
	`stripeSubscriptionId` varchar(255),
	`trialEndsAt` timestamp,
	`currentPeriodStart` timestamp,
	`currentPeriodEnd` timestamp,
	`cancelAtPeriodEnd` boolean NOT NULL DEFAULT false,
	`canceledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizationSubscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `organization_subscriptions_org_unique` UNIQUE(`organizationId`),
	CONSTRAINT `organization_subscriptions_stripe_subscription_unique` UNIQUE(`stripeSubscriptionId`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`status` enum('active','suspended','archived') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizations_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `passwordResetTokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `passwordResetTokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `password_reset_token_hash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `subscriptionPlans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(80) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`isSystemPlan` boolean NOT NULL DEFAULT false,
	`priceCents` int NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'usd',
	`billingInterval` enum('month','year') NOT NULL DEFAULT 'month',
	`trialDays` int NOT NULL DEFAULT 14,
	`maxProjects` int,
	`maxSeats` int,
	`features` json,
	`stripeProductId` varchar(255),
	`stripePriceId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptionPlans_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscription_plans_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `openId` varchar(64);--> statement-breakpoint
ALTER TABLE `countingCategories` ADD `organizationId` int;--> statement-breakpoint
ALTER TABLE `projects` ADD `organizationId` int;--> statement-breakpoint
ALTER TABLE `users` ADD `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `mustChangePassword` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `isActive` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `isPlatformOwner` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `authSessions` (`userId`);--> statement-breakpoint
CREATE INDEX `billing_webhook_events_type_idx` ON `billingWebhookEvents` (`eventType`);--> statement-breakpoint
CREATE INDEX `organization_invitations_org_idx` ON `organizationInvitations` (`organizationId`);--> statement-breakpoint
CREATE INDEX `organization_invitations_email_idx` ON `organizationInvitations` (`email`);--> statement-breakpoint
CREATE INDEX `organization_members_user_idx` ON `organizationMembers` (`userId`);--> statement-breakpoint
CREATE INDEX `organization_subscriptions_status_idx` ON `organizationSubscriptions` (`status`);--> statement-breakpoint
CREATE INDEX `password_reset_user_idx` ON `passwordResetTokens` (`userId`);--> statement-breakpoint
CREATE INDEX `subscription_plans_active_idx` ON `subscriptionPlans` (`isActive`);--> statement-breakpoint
CREATE INDEX `counting_categories_organization_idx` ON `countingCategories` (`organizationId`);--> statement-breakpoint
CREATE INDEX `projects_organization_idx` ON `projects` (`organizationId`);