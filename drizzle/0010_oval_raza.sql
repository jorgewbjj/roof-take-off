CREATE TABLE `callouts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`tabId` int,
	`anchorX` float NOT NULL,
	`anchorY` float NOT NULL,
	`bubbleX` float NOT NULL,
	`bubbleY` float NOT NULL,
	`bubbleW` float NOT NULL DEFAULT 160,
	`bubbleH` float NOT NULL DEFAULT 60,
	`text` varchar(500) NOT NULL DEFAULT 'Label',
	`color` varchar(7) NOT NULL DEFAULT '#fef9c3',
	`textColor` varchar(7) NOT NULL DEFAULT '#1e293b',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `callouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cutouts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`parentMeasurementId` int NOT NULL,
	`tabId` int,
	`name` varchar(255) NOT NULL DEFAULT 'Cutout',
	`area` decimal(12,2) NOT NULL,
	`coordinates` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cutouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dimensionLines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`tabId` int,
	`x1` float NOT NULL,
	`y1` float NOT NULL,
	`x2` float NOT NULL,
	`y2` float NOT NULL,
	`offsetPx` float NOT NULL DEFAULT 40,
	`customLabel` varchar(100),
	`color` varchar(7) NOT NULL DEFAULT '#1e40af',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dimensionLines_id` PRIMARY KEY(`id`)
);
