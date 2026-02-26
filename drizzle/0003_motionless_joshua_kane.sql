ALTER TABLE `measurements` MODIFY COLUMN `area` decimal(12,2);--> statement-breakpoint
ALTER TABLE `measurements` ADD `type` enum('area','line','point') DEFAULT 'area' NOT NULL;--> statement-breakpoint
ALTER TABLE `measurements` ADD `count` int;