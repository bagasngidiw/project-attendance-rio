Do NOT modify any files.

Inspect the backend codebase and determine exactly how the application currently connects to MongoDB.

Find and report:

1. MongoDB library/driver being used
2. Whether the project uses Mongoose or the native MongoDB driver
3. The exact environment variable name used for the MongoDB connection
4. The current MongoDB connection implementation
5. The current database name
6. Where the connection is initialized
7. Which backend entry point initializes the connection
8. Whether the connection is required before starting the Express server
9. Whether there are any development-only MongoDB configurations
10. Whether there are any hardcoded localhost MongoDB URLs
11. Which .env variables are required for production
12. Whether the backend already supports MongoDB Atlas connection strings

Read the actual source code, package.json files, .env.example files, configuration files, and relevant documentation.

Do not guess.

Do not modify anything.

Return the findings clearly and tell me exactly what environment variable I need to configure in Render for MongoDB Atlas.

Also tell me whether any code changes are actually required.

STOP after reporting the findings.