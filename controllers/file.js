// Packages
import asyncHandler from 'express-async-handler';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';

// Middlewares
import { verifyData } from '../middlewares/verifyData.js';

// Variables
const prisma = new PrismaClient();
const upload = multer({
	storage: multer.memoryStorage(),
});

cloudinary.config({
	cloud_name: process.env.CLOUDINARY_NAME,
	api_key: process.env.CLOUDINARY_API_KEY,
	api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const createFile = [
	upload.single('file'),
	(req, res, next) => {
		req.file
			? next()
			: res.status(400).json({
					success: false,
					message: 'File is required.',
			  });
	},
	asyncHandler(async (req, res, next) => {
		const { pk: userPk } = req.user;
		const { folderId } = req.params;

		const folder = await prisma.folder.findUnique({
			where: { ownerId: userPk, id: folderId },
			select: {
				pk: true,
			},
		});

		const handleSetLocalVariable = () => {
			req.folder = folder;
			next();
		};

		folder
			? handleSetLocalVariable()
			: res.status(404).json({
					success: false,
					message: 'Folder could not been found.',
			  });
	}),
	asyncHandler(async (req, res, next) => {
		const { folderId } = req.params;

		let { originalname, buffer } = req.file;

		await new Promise(resolve =>
			cloudinary.uploader
				.upload_stream(
					{
						display_name: Buffer.from(originalname, 'latin1').toString('utf8'), // For busboy defParanCharset issue (multer)
						resource_type: 'auto',
						public_id_prefix: folderId,
					},
					(err, result) => {
						const handleSetLocalVariable = () => {
							req.upload = result;
							resolve();
							next();
						};
						err ? next(err) : handleSetLocalVariable();
					}
				)
				.end(buffer)
		);
	}),
	async (req, res, next) => {
		const { public_id, resource_type, secure_url } = req.upload;
		const { originalname, size } = req.file;
		const { pk: folderPk } = req.folder;
		const { pk: userPk } = req.user;

		try {
			await prisma.file.create({
				data: {
					id: public_id.split('/')[1],
					name: Buffer.from(originalname, 'latin1').toString('utf8'),
					size,
					type: resource_type,
					secure_url,
					ownerId: userPk,
					folderId: folderPk,
				},
			});
			res.json({
				success: true,
				message: 'Upload file is successfully',
			});
		} catch (err) {
			await cloudinary.uploader.destroy(public_id, { resource_type });
			next(err);
		}
	},
];

export const updateFile = [
	verifyData({
		name: {
			trim: true,
			notEmpty: {
				errorMessage: 'File name is required.',
				bail: true,
			},
			isLength: {
				options: { max: 200 },
				errorMessage: 'File name must be less then 200 letters.',
				bail: true,
			},
		},
	}),
	asyncHandler(async (req, res, next) => {
		const { pk: userPk } = req.user;
		const { fileId } = req.params;

		const file = await prisma.file.findUnique({
			where: { ownerId: userPk, id: fileId },
			select: {
				pk: true,
				type: true,
				folder: {
					select: {
						id: true,
					},
				},
			},
		});

		const handleSetLocalVariable = () => {
			req.file = file;
			next();
		};

		file
			? handleSetLocalVariable()
			: res.status(404).json({
					success: false,
					message: 'File could not been found.',
			  });
	}),
	asyncHandler(async (req, res, next) => {
		const { name } = req.data;
		const { fileId } = req.params;
		const { type, folder } = req.file;

		const response = await cloudinary.uploader.explicit(
			`${folder.id}/${fileId}`,
			{
				type: 'upload',
				resource_type: type,
				display_name: name,
			}
		);

		response.name === 'Error' ? next('error') : next();
	}),
	asyncHandler(async (req, res) => {
		const { name } = req.data;
		const { pk } = req.file;

		await prisma.file.update({
			where: { pk },
			data: {
				name,
			},
		});

		res.json({
			success: true,
			message: 'Update folder successfully.',
		});
	}),
];

export const deleteFile = [
	asyncHandler(async (req, res, next) => {
		const { pk: userPk } = req.user;
		const { fileId } = req.params;

		const file = await prisma.file.findUnique({
			where: { ownerId: userPk, id: fileId },
			select: {
				pk: true,
				type: true,
				folder: {
					select: {
						id: true,
					},
				},
			},
		});

		const handleSetLocalVariable = () => {
			req.file = file;
			next();
		};

		file
			? handleSetLocalVariable()
			: res.status(404).json({
					success: false,
					message: 'File could not been found.',
			  });
	}),
	asyncHandler(async (req, res, next) => {
		const { fileId } = req.params;
		const { type, folder } = req.file;

		const response = await cloudinary.uploader.destroy(
			`${folder.id}/${fileId}`,
			{ resource_type: type }
		);

		response.result === 'ok'
			? next()
			: response.result === 'not found'
			? next('Not found')
			: next(response.result);
	}),
	asyncHandler(async (req, res) => {
		const { pk } = req.file;

		await prisma.$transaction([
			prisma.fileSharers.deleteMany({
				where: {
					fileId: pk,
				},
			}),
			prisma.publicFile.deleteMany({
				where: {
					fileId: pk,
				},
			}),
			prisma.file.delete({
				where: {
					pk,
				},
			}),
		]);

		res.json({
			success: true,
			message: 'Delete file successfully.',
		});
	}),
];
