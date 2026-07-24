CREATE TABLE `planTabs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`name` varchar(255) NOT NULL DEFAULT 'Plan 1',
	`sortOrder` int NOT NULL DEFAULT 0,
	`pdfUrl` text NOT NULL,
	`pdfKey` text NOT NULL,
	`scale` decimal(10,4) DEFAULT '1.0000',
	`scaleUnit` varchar(20) DEFAULT 'ft',
	`currentPage` int NOT NULL DEFAULT 1,
	`totalPages` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `planTabs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `measurements` ADD `tabId` int;--> statement-breakpoint
ALTER TABLE `textAnnotations` ADD `tabId` int;