/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define([
    'N/record',
    'N/render',
    'N/email',
    'N/file',
    'N/log'
], (
    record,
    render,
    email,
    file,
    log
) => {

    // XML template file internal ID
    const TEMPLATE_FILE_ID = 33686;

    // Employee internal ID used as the email sender
    const SENDER_EMPLOYEE_ID = 9710;

    // Employee internal ID receiving the test email
    const RECIPIENT_EMPLOYEE_ID = 9710;

    // Task validation fields
    const STATUS_FIELD_ID = 'status';
    const COMPLETE_STATUS_VALUE = 'COMPLETE';

    const SIGNATURE_FIELD_ID =
        'custevent_nx_customer_signature';

    /**
     * Safely get a record field value.
     */
    const safeGetValue = (rec, fieldId) => {
        try {
            return rec.getValue({
                fieldId: fieldId
            });
        } catch (error) {
            return '';
        }
    };

    /**
     * Create the PDF renderer.
     *
     * The Task will be available in the XML as:
     *
     * ${record.title}
     * ${record.status}
     * ${record.custevent_nx_customer_signature}
     *
     * Or:
     *
     * ${task.title}
     * ${task.status}
     * ${task.custevent_nx_customer_signature}
     */
    const createTaskRenderer = (
        templateContent,
        taskRec
    ) => {

        const renderer = render.create();

        renderer.templateContent = templateContent;

        // Make Task available as ${record.fieldid}
        renderer.addRecord({
            templateName: 'record',
            record: taskRec
        });

        // Make Task available as ${task.fieldid}
        renderer.addRecord({
            templateName: 'task',
            record: taskRec
        });

        return renderer;
    };

    const afterSubmit = (context) => {
        try {
            const allowedEvents = [
                context.UserEventType.CREATE,
                context.UserEventType.EDIT,
                context.UserEventType.XEDIT
            ];

            if (allowedEvents.indexOf(context.type) === -1) {
                return;
            }

            const taskId = context.newRecord.id;

            if (!taskId) {
                log.error({
                    title: 'Missing Task ID',
                    details:
                        'The Task internal ID was not available.'
                });
                return;
            }

            log.audit({
                title: 'Task Service Report Started',
                details: {
                    taskId: taskId,
                    eventType: context.type
                }
            });

            // -----------------------------------------------------
            // Load the complete Task record
            // -----------------------------------------------------

            const taskRec = record.load({
                type: record.Type.TASK,
                id: taskId,
                isDynamic: false
            });

            // -----------------------------------------------------
            // Validation 1: Task status must be Complete
            // -----------------------------------------------------

            const taskStatus = taskRec.getValue({
                fieldId: STATUS_FIELD_ID
            });

            log.debug({
                title: 'Task Status Validation',
                details: {
                    taskId: taskId,
                    currentStatus: taskStatus,
                    requiredStatus: COMPLETE_STATUS_VALUE
                }
            });

            if (taskStatus !== COMPLETE_STATUS_VALUE) {
                log.audit({
                    title:
                        'Service Report Skipped - Task Not Complete',
                    details: {
                        taskId: taskId,
                        currentStatus: taskStatus
                    }
                });
                return;
            }

            // -----------------------------------------------------
            // Validation 2: Customer signature must be populated
            // -----------------------------------------------------

            const customerSignature = taskRec.getValue({
                fieldId: SIGNATURE_FIELD_ID
            });

            log.debug({
                title: 'Customer Signature Validation',
                details: {
                    taskId: taskId,
                    signaturePopulated:
                        Boolean(customerSignature),
                    signatureLength:
                        customerSignature
                            ? String(customerSignature).length
                            : 0
                }
            });

            if (!customerSignature) {
                log.audit({
                    title:
                        'Service Report Skipped - Signature Missing',
                    details: {
                        taskId: taskId,
                        signatureFieldId:
                            SIGNATURE_FIELD_ID
                    }
                });
                return;
            }

            // -----------------------------------------------------
            // Read useful Task values for logging and email
            // -----------------------------------------------------

            const taskTitle =
                safeGetValue(taskRec, 'title') ||
                'Task ' + taskId;

            const taskCompanyValue =
                safeGetValue(taskRec, 'company');

            let taskCompanyText = '';

            try {
                taskCompanyText = taskRec.getText({
                    fieldId: 'company'
                });
            } catch (companyError) {
                taskCompanyText = '';
            }

            log.audit({
                title: 'Task Values Before Rendering',
                details: {
                    taskId: taskId,
                    taskTitle: taskTitle,
                    taskStatus: taskStatus,
                    companyValue: taskCompanyValue,
                    companyText: taskCompanyText,
                    customerName: safeGetValue(
                        taskRec,
                        'custevent_nx_customer_name'
                    ),
                    technicianName: safeGetValue(
                        taskRec,
                        'custevent_bc_fsm_tech_name'
                    ),
                    customerSignaturePopulated:
                        Boolean(customerSignature)
                }
            });

            // -----------------------------------------------------
            // Load recipient Employee
            // -----------------------------------------------------

            const recipientEmployeeRec = record.load({
                type: record.Type.EMPLOYEE,
                id: RECIPIENT_EMPLOYEE_ID,
                isDynamic: false
            });

            const recipientEmail =
                recipientEmployeeRec.getValue({
                    fieldId: 'email'
                });

            const recipientName =
                recipientEmployeeRec.getValue({
                    fieldId: 'entityid'
                }) || 'Employee';

            if (!recipientEmail) {
                log.error({
                    title:
                        'Recipient Employee Has No Email',
                    details: {
                        employeeId:
                            RECIPIENT_EMPLOYEE_ID
                    }
                });
                return;
            }

            log.debug({
                title: 'Email Recipient',
                details: {
                    employeeId:
                        RECIPIENT_EMPLOYEE_ID,
                    employeeName: recipientName,
                    employeeEmail: recipientEmail
                }
            });

            // -----------------------------------------------------
            // Load the XML template file
            // -----------------------------------------------------

            const templateFile = file.load({
                id: TEMPLATE_FILE_ID
            });

            const templateContent =
                templateFile.getContents();

            if (!templateContent) {
                log.error({
                    title: 'Empty XML Template',
                    details: {
                        templateFileId:
                            TEMPLATE_FILE_ID,
                        templateName:
                            templateFile.name
                    }
                });
                return;
            }

            const templateVariables =
                templateContent.match(
                    /\$\{[^}]+\}/g
                ) || [];

            log.debug({
                title: 'Task XML Template Information',
                details: {
                    templateId: TEMPLATE_FILE_ID,
                    templateName: templateFile.name,
                    templateSize:
                        templateContent.length,

                    usesRecordAlias:
                        templateContent.indexOf(
                            '${record.'
                        ) !== -1,

                    usesTaskAlias:
                        templateContent.indexOf(
                            '${task.'
                        ) !== -1,

                    usesCaseAlias:
                        templateContent.indexOf(
                            '${case.'
                        ) !== -1,

                    usesServiceOrderAlias:
                        templateContent.indexOf(
                            '${serviceOrder.'
                        ) !== -1,

                    variables:
                        templateVariables.slice(0, 100)
                }
            });

            // -----------------------------------------------------
            // Generate a merged XML preview for testing
            // -----------------------------------------------------

            try {
                const previewRenderer =
                    createTaskRenderer(
                        templateContent,
                        taskRec
                    );

                const renderedXml =
                    previewRenderer.renderAsString();

                log.debug({
                    title: 'Rendered Task XML Preview',
                    details: JSON.stringify(
                        renderedXml.substring(
                            0,
                            3900
                        )
                    )
                });

            } catch (previewError) {
                log.error({
                    title:
                        'Rendered Task XML Preview Error',
                    details: {
                        name:
                            previewError.name || '',
                        message:
                            previewError.message ||
                            String(previewError),
                        stack:
                            previewError.stack || ''
                    }
                });
            }

            // -----------------------------------------------------
            // Render the Task PDF
            // -----------------------------------------------------

            const pdfRenderer =
                createTaskRenderer(
                    templateContent,
                    taskRec
                );

            const pdfFile =
                pdfRenderer.renderAsPdf();

            pdfFile.name =
                'Task_Service_Report_' +
                taskId +
                '.pdf';

            log.audit({
                title: 'Task Service Report PDF Generated',
                details: {
                    taskId: taskId,
                    taskTitle: taskTitle,
                    pdfName: pdfFile.name,
                    pdfSize: pdfFile.size
                }
            });

            // -----------------------------------------------------
            // Email the PDF
            // -----------------------------------------------------

            email.send({
                author: SENDER_EMPLOYEE_ID,

                // Employee internal ID
                recipients: RECIPIENT_EMPLOYEE_ID,

                subject:
                    'Task Service Report - ' +
                    taskTitle,

                body:
                    'Hi ' +
                    recipientName +
                    ',\n\n' +
                    'Please find attached the service report ' +
                    'for the following Task:\n\n' +
                    'Task ID: ' +
                    taskId +
                    '\n' +
                    'Task Title: ' +
                    taskTitle +
                    '\n' +
                    'Customer: ' +
                    (taskCompanyText || '') +
                    '\n\n' +
                    'The report was generated automatically ' +
                    'after the Task was completed and the ' +
                    'customer signature was captured.' +
                    '\n\nThank you.',

                attachments: [
                    pdfFile
                ]
            });

            log.audit({
                title:
                    'Task Service Report Email Sent',
                details: {
                    taskId: taskId,
                    taskTitle: taskTitle,
                    recipientEmployeeId:
                        RECIPIENT_EMPLOYEE_ID,
                    recipientEmail:
                        recipientEmail,
                    senderEmployeeId:
                        SENDER_EMPLOYEE_ID,
                    pdfName: pdfFile.name
                }
            });

        } catch (error) {
            log.error({
                title:
                    'Task Service Report afterSubmit Error',
                details: {
                    name: error.name || '',
                    message:
                        error.message ||
                        String(error),
                    stack: error.stack || ''
                }
            });
        }
    };

    return {
        afterSubmit: afterSubmit
    };
});