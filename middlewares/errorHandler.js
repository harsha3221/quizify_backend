/**
 * Global Error Handler Middleware
 * Catches all unhandled exceptions thrown by asynchronous controllers.
 */
const errorHandler = (err, req, res, next) => {
    console.error(`[Error] ${err.message || 'Unknown Error'}`);

    // Log the full stack trace in development
    const isProduction = process.env.NODE_ENV === 'production';
    if (!isProduction) {
        console.error(err.stack);
    }

    const statusCode = err.statusCode || err.code || 500;

    // Ensure we send a valid HTTP status code
    const validStatusCode = (typeof statusCode === 'number' && statusCode >= 100 && statusCode < 600)
        ? statusCode
        : 500;

    // Determine safe user-facing message
    // If it's a 4xx error (validation/client fault), it's safe to send. 
    // If it's a 5xx system error, only show the raw message in development mode.
    let safeMessage = err.message || 'Internal Server Error';
    if (isProduction && validStatusCode >= 500) {
        safeMessage = 'An internal server error occurred. Please try again later.';
    }

    res.status(validStatusCode).json({
        success: false,
        message: safeMessage,
        ...(!isProduction && { stack: err.stack })
    });
};

module.exports = errorHandler;