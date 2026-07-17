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
    const SENDER_ID = 9710;

    // Task fields
    const STATUS_FIELD_ID = 'status';
    const STATUS_SUBMITTED_VALUE = 'COMPLETE';
    const SIGNATURE_FIELD_ID = 'custevent_nx_customer_signature';

    // Customer email field — currently not used during testing
    const CUSTOMER_EMAIL_FIELD_ID = 'custevent_bc_fsm_cust_email';

    // Testing recipient
    const TEST_EMAIL = 'dhruv.soni@bluecollar.cloud';

    const afterSubmit = (context) => {
        try {
            if (
                context.type !== context.UserEventType.CREATE &&
                context.type !== context.UserEventType.EDIT &&
                context.type !== context.UserEventType.XEDIT
            ) {
                return;
            }

            const taskId = context.newRecord.id;

            if (!taskId) {
                log.error({
                    title: 'Missing Task ID',
                    details: 'Task internal ID was not available.'
                });
                return;
            }

            /*
             * Load the full Task record.
             *
             * This is required because an XEDIT event may only contain
             * the fields that were changed.
             */
            const taskRec = record.load({
                type: record.Type.TASK,
                id: taskId,
                isDynamic: false
            });

            // -------------------------------------------------------------
            // Condition 1: Task must be Complete
            // -------------------------------------------------------------

            const taskStatus = taskRec.getValue({
                fieldId: STATUS_FIELD_ID
            });

            log.debug({
                title: 'Task Status Check',
                details: {
                    taskId: taskId,
                    currentStatus: taskStatus,
                    requiredStatus: STATUS_SUBMITTED_VALUE
                }
            });

            if (taskStatus !== STATUS_SUBMITTED_VALUE) {
                log.debug({
                    title: 'Skipped - Task Not Complete',
                    details:
                        'Task ' + taskId +
                        ' status is "' + taskStatus +
                        '", not "' + STATUS_SUBMITTED_VALUE + '".'
                });

                return;
            }

            // -------------------------------------------------------------
            // Condition 2: Customer signature must be populated
            // -------------------------------------------------------------

            const customerSignature = taskRec.getValue({
                fieldId: SIGNATURE_FIELD_ID
            });

            if (!customerSignature) {
                log.debug({
                    title: 'Skipped - Customer Signature Missing',
                    details:
                        'Task ' + taskId +
                        ' does not have a customer signature.'
                });

                return;
            }

            // -------------------------------------------------------------
            // Customer email condition — commented out for testing
            // -------------------------------------------------------------

            /*
            const reportEmail = taskRec.getValue({
                fieldId: CUSTOMER_EMAIL_FIELD_ID
            });

            if (!reportEmail) {
                log.debug({
                    title: 'Skipped - Customer Email Missing',
                    details:
                        'Task ' + taskId +
                        ' does not have a customer email.'
                });

                return;
            }
            */

            // Testing recipient
            const reportEmail = TEST_EMAIL;

            // -------------------------------------------------------------
            // Load the XML template
            // -------------------------------------------------------------

            const templateFile = file.load({
                id: TEMPLATE_FILE_ID
            });

            const templateContent = templateFile.getContents();

            if (!templateContent) {
                log.error({
                    title: 'Empty XML Template',
                    details:
                        'XML template file ' +
                        TEMPLATE_FILE_ID +
                        ' is empty.'
                });

                return;
            }

            log.debug({
                title: 'Task Data for Service Report',
                details: {
                    taskId: taskId,

                    title: taskRec.getValue({
                        fieldId: 'title'
                    }),

                    status: taskStatus,

                    technicianName: taskRec.getValue({
                        fieldId: 'custevent_bc_fsm_tech_name'
                    }),

                    customerName: taskRec.getValue({
                        fieldId: 'custevent_nx_customer_name'
                    }),

                    technicianSignaturePopulated: Boolean(
                        taskRec.getValue({
                            fieldId: 'custevent_nx_technician_signature'
                        })
                    ),

                    customerSignaturePopulated: Boolean(
                        customerSignature
                    )
                }
            });

            // -------------------------------------------------------------
            // Create the Task Service Report PDF
            // -------------------------------------------------------------

            const renderer = render.create();

            renderer.templateContent = templateContent;

            /*
             * The XML contains fields such as:
             *
             * ${task.custevent_bc_fsm_tech_name}
             * ${task.custevent_nx_customer_name}
             * ${task.custevent_nx_customer_signature}
             *
             * Therefore, load the Task under the "task" alias.
             */
            renderer.addRecord({
                templateName: 'task',
                record: taskRec
            });

            /*
             * The XML also contains dynamic references such as:
             *
             * ${record[field.inlineimage]}
             * ${record[field.image]}
             *
             * Therefore, the same Task must also be available under
             * the "record" alias.
             */
            renderer.addRecord({
                templateName: 'record',
                record: taskRec
            });

            const pdfFile = renderer.renderAsPdf();

            pdfFile.name =
                'Task_Service_Report_' + taskId + '.pdf';

            log.audit({
                title: 'Task Service Report Generated',
                details: {
                    taskId: taskId,
                    templateFileId: TEMPLATE_FILE_ID,
                    pdfName: pdfFile.name,
                    pdfSize: pdfFile.size
                }
            });

            // -------------------------------------------------------------
            // Send email with PDF attachment
            // -------------------------------------------------------------

            email.send({
                author: SENDER_ID,
                recipients: reportEmail,

                subject:
                    'Task Service Report - Task #' + taskId,

                body:
                    'Hi,\n\n' +
                    'Please find attached the service report for Task #' +
                    taskId + '.\n\n' +
                    'The report was generated automatically after the ' +
                    'task was completed and the customer signature was captured.\n\n' +
                    'Thank you.',

                attachments: [
                    pdfFile
                ]

                /*
                 * No relatedRecords property.
                 *
                 * The email is not explicitly attached to the Case,
                 * Task, Employee, Customer, or any other record.
                 */
            });

            log.audit({
                title: 'Task Service Report Sent',
                details: {
                    taskId: taskId,
                    recipient: reportEmail,
                    senderEmployeeId: SENDER_ID,
                    pdfName: pdfFile.name,
                    pdfSize: pdfFile.size
                }
            });

        } catch (e) {
            log.error({
                title: 'Task Service Report Error',
                details: {
                    name: e.name || '',
                    message: e.message || String(e),
                    stack: e.stack || ''
                }
            });
        }
    };

    return {
        afterSubmit: afterSubmit
    };
});